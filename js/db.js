/* Simple localStorage-backed data layer.
   Swap-in point for IndexedDB later without touching app.js's public API. */
const DB = (() => {
  // BUGFIX (account-switch data loss): storage used to be one shared key for every
  // identity on the device, so logging in as a second user overwrote the first
  // user's local data on their next save. Now each uid gets its own key.
  // KEY_PREFIX with no suffix is the LEGACY pre-fix key — kept around only as a
  // one-time migration source for existing installs, never written to on purpose.
  const KEY_PREFIX = 'madhom_v1';

  function _keyFor(ownerUid) {
    return ownerUid ? `${KEY_PREFIX}_${ownerUid}` : KEY_PREFIX;
  }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function seed() {
    return {
      family: '',
      children: [],
      medicines: [
        { id: uid(), name: 'אקמול ילדים', createdAt: Date.now(), updatedAt: Date.now() },
        { id: uid(), name: 'נורופן',       createdAt: Date.now(), updatedAt: Date.now() },
        { id: uid(), name: 'נובימול',      createdAt: Date.now(), updatedAt: Date.now() },
        { id: uid(), name: 'ויטמין D',     createdAt: Date.now(), updatedAt: Date.now() },
      ],
      medEntries: [],
      tempEntries: [],
      prescriptions: [], // active/past treatments (e.g. "daily vitamin D reminder", future: antibiotic courses)
      settings: { notifications: false },
      // stable per-installation id used to target push notifications to THIS device only
      // (via OneSignal external_id / login) instead of broadcasting to all subscribers.
      // generated once and carried forward by the load() merge below on every existing install.
      deviceId: uid() + uid(),
      // Stage B — Identity Bridge
      // auth.uid  = Firebase uid of the account that owns this local state.
      // auth.familyId = Firestore familyId, cached locally so it survives offline / fast reload.
      // Both are set after successful login/signup and cleared on logout.
      // Firestore is still the authority — this is a cache only.
      auth: { uid: null, familyId: null },
    };
  }

  /* Read + parse + migrate whatever is under a specific storage key.
     Returns null if the key is empty or unreadable/corrupted (caller decides what to do —
     this function never writes anything, so it's safe to call speculatively). */
  function _loadKey(key) {
    let raw;
    try {
      raw = localStorage.getItem(key);
    } catch (e) {
      return null; // localStorage itself inaccessible (very rare)
    }
    if (!raw) return null;

    try {
      // merge: any top-level field added to seed() since this user last saved (e.g. `prescriptions`)
      // gets its default value, without touching the user's existing data
      const merged = { ...seed(), ...JSON.parse(raw) };
      // Stage B: ensure auth sub-object always exists (migration for existing installs)
      if (!merged.auth || typeof merged.auth !== 'object') {
        merged.auth = { uid: null, familyId: null };
      }
      // C1: migrate medicines from string[] to object[] with stable IDs
      merged.medicines = migrateMedicines(merged.medicines);
      // C1: migrate prescriptions — COURSE fields + doseLog IDs + updatedAt
      merged.prescriptions = merged.prescriptions.map(migrateRx);
      // C1: migrate children — ensure createdAt/updatedAt
      merged.children = merged.children.map(migrateChild);
      // C1: migrate medEntries / tempEntries — ensure updatedAt
      merged.medEntries   = merged.medEntries.map(migrateTsEntry);
      merged.tempEntries  = merged.tempEntries.map(migrateTsEntry);
      // C1: migrate settings — ensure updatedAt
      if (!merged.settings.updatedAt) merged.settings.updatedAt = Date.now();
      return merged;
    } catch (e) {
      // JSON is corrupted — back up the raw string so it can still be recovered manually later
      // (data isn't just gone silently). Caller seeds fresh for this key.
      try { localStorage.setItem(key + '_corrupted_' + Date.now(), raw); } catch (e2) { /* best-effort backup only */ }
      return null;
    }
  }

  /* Initial synchronous load at module-eval time, BEFORE any uid is known.
     Reads the legacy shared key exactly as before this fix — purely so the UI has
     something to render before Firebase auth resolves. Superseded immediately once
     setAuth()/clearAuth() run (see app.js auth routing, unchanged by this fix). */
  function load() {
    const existing = _loadKey(KEY_PREFIX);
    if (existing) return existing;
    const s = seed();
    try { localStorage.setItem(KEY_PREFIX, JSON.stringify(s)); } catch (e) {
      alert('שגיאה קריטית: לא ניתן לשמור נתונים במכשיר זה. יש לפנות מקום אחסון ולרענן את הדף.');
    }
    return s;
  }

  /* C1: migrate medicines array — strings → {id, name, createdAt, updatedAt} objects.
     Safe to run repeatedly: objects already in the new format pass through unchanged.
     Deduplicates by name (case-insensitive). */
  function migrateMedicines(arr) {
    const seen = new Set();
    return (arr || []).map((m) => {
      if (typeof m === 'string') {
        // legacy string entry
        const name = m.trim();
        const key  = name.toLowerCase();
        if (seen.has(key)) return null; // duplicate — drop
        seen.add(key);
        return { id: uid(), name, createdAt: Date.now(), updatedAt: Date.now() };
      }
      // already an object — ensure shape + dedup
      const key = (m.name || '').toLowerCase();
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        id:        m.id        || uid(),
        name:      m.name      || '',
        createdAt: m.createdAt || Date.now(),
        updatedAt: m.updatedAt || Date.now(),
      };
    }).filter(Boolean);
  }

  /* C1: migrate a child record — ensure createdAt + updatedAt. */
  function migrateChild(c) {
    return {
      ...c,
      createdAt: c.createdAt || Date.now(),
      updatedAt: c.updatedAt || c.createdAt || Date.now(),
    };
  }

  /* C1: migrate a medEntry or tempEntry — ensure updatedAt. */
  function migrateTsEntry(e) {
    return {
      ...e,
      createdAt: e.createdAt || e.time || Date.now(),
      updatedAt: e.updatedAt || e.time || Date.now(),
    };
  }

  /* Ensure a prescription record has all COURSE fields.
     Safe to run on old records — leaves non-course prescriptions intact (isCourse stays false). */
  function migrateRx(rx) {
    const base = {
      isCourse:     false,
      totalDays:    null,
      dosesPerDay:  null,
      doseLog:      [],
      createdAt:    rx.startAt || Date.now(),
      updatedAt:    rx.updatedAt || rx.startAt || Date.now(),
      ...rx,
    };
    // C1: ensure every doseLog entry has a stable ID
    base.doseLog = (base.doseLog || []).map((d) =>
      d.id ? d : { id: uid(), ...d }
    );
    return base;
  }

  // ── Real Family Sync (Stage C) — ADDITIVE layer only ────────────────────────
  // Everything below adds Firestore sync alongside the existing localStorage
  // flow above. Nothing above this line changes behaviour when sync is not
  // initialised (_fsFamilyId stays null) — the app works exactly as it did
  // before this stage, purely local, until initSync() is explicitly called.
  const SYNCED_COLLECTIONS = ['children', 'medicines', 'medEntries', 'tempEntries', 'prescriptions'];
  let _fsFamilyId = null;              // familyId currently being synced, or null
  let _fsUnsubscribers = [];           // onSnapshot() unsubscribe functions
  let _syncStatus = { state: 'idle', error: null }; // 'idle' | 'pending' | 'synced' | 'failed'
  let _changeListeners = [];           // callbacks notified when remote data changes local state

  function _fsFamilyRef(familyId) {
    return firebase.firestore().collection('families').doc(familyId);
  }

  function _setSyncStatus(next, err) {
    _syncStatus = { state: next, error: err ? String(err.message || err) : null };
  }

  function _notifyChange() {
    _changeListeners.forEach((cb) => { try { cb(); } catch (e) { /* listener's own bug, not ours */ } });
  }

  /* Push one record to its Firestore doc. Fire-and-forget from the caller's point of
     view (existing DB.* methods stay synchronous) — pending/synced/failed status is
     tracked separately via getSyncStatus(), never silently swallowed. */
  function _pushToFirestore(entityType, record) {
    if (!_fsFamilyId) return; // sync not initialised — local-only, unchanged behaviour
    const payload = { ...record, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
    _setSyncStatus('pending');
    _fsFamilyRef(_fsFamilyId).collection(entityType).doc(record.id).set(payload, { merge: true })
      .then(() => { _setSyncStatus('synced'); })
      .catch((err) => {
        console.error(`[Sync] push failed (${entityType}/${record.id}):`, err);
        _setSyncStatus('failed', err);
      });
  }

  /* Merge one incoming Firestore document into local state, by id, using last-write-wins
     on updatedAt. NEVER regresses local state: if the local copy is the same age or newer
     (e.g. this is our own pending write echoing back), this is a safe no-op.
     Does NOT push back to Firestore — this is a one-way remote-to-local application. */
  function _applyRemoteDoc(entityType, id, data) {
    const toMillis = (v) => (v && typeof v.toMillis === 'function') ? v.toMillis() : (v || 0);
    const normalized = { ...data, id, updatedAt: toMillis(data.updatedAt) };
    if (data.createdAt !== undefined) normalized.createdAt = toMillis(data.createdAt);

    const list = state[entityType];
    const idx = list.findIndex((r) => r.id === id);
    if (idx === -1) {
      list.push(normalized);
    } else if (normalized.updatedAt > (list[idx].updatedAt || 0)) {
      list[idx] = normalized;
    }
    // else: local is same-or-newer — no-op, by design (see comment above)
  }

  /* One-time backfill of existing local records into Firestore, for an existing install
     upgrading to this sync-enabled version. Safe under concurrent runs from two devices:
     each record is compared (get-before-set) against whatever's already remote, and
     whichever side has the newer updatedAt wins — never a blind overwrite. Safe to re-run
     (idempotent): a record already correctly migrated is simply left alone (same or older). */
  async function _migrateLocalToFirestore(familyId) {
    const metaRef = _fsFamilyRef(familyId).collection('_meta').doc('migration');
    try {
      const metaSnap = await metaRef.get();
      if (metaSnap.exists && metaSnap.data().done) return; // already migrated by this or another device
    } catch (e) {
      console.warn('[Sync] could not read migration marker, proceeding cautiously:', e.message);
    }

    for (const entityType of SYNCED_COLLECTIONS) {
      const records = state[entityType] || [];
      for (const record of records) {
        const ref = _fsFamilyRef(familyId).collection(entityType).doc(record.id);
        try {
          const remoteSnap = await ref.get();
          if (!remoteSnap.exists) {
            // no collision — pure backfill, safe to write as-is (client timestamps preserved,
            // this is historical data, not a live edit)
            await ref.set(record);
          } else {
            const remote = remoteSnap.data();
            const remoteUpdatedAt = (remote.updatedAt && remote.updatedAt.toMillis) ? remote.updatedAt.toMillis() : (remote.updatedAt || 0);
            const localUpdatedAt = record.updatedAt || 0;
            if (localUpdatedAt > remoteUpdatedAt) {
              // this device's copy is genuinely newer than what's already there — safe to overwrite
              await ref.set(record);
            }
            // else: remote is same-or-newer (very likely the other device already migrated
            // this exact record) — leave it alone, do not overwrite
          }
        } catch (e) {
          console.error(`[Sync] migration failed for ${entityType}/${record.id}:`, e.message);
          // continue with the rest — one bad record shouldn't block the whole migration
        }
      }
    }

    try { await metaRef.set({ done: true, at: firebase.firestore.FieldValue.serverTimestamp() }); }
    catch (e) { /* best-effort — a second device might set this moments later too, harmless */ }
  }

  function _subscribeToCollection(familyId, entityType) {
    const unsub = _fsFamilyRef(familyId).collection(entityType)
      .onSnapshot({ includeMetadataChanges: true }, (snap) => {
        let changed = false;
        snap.docChanges().forEach((change) => {
          if (change.type === 'removed') return; // we never hard-delete; soft-delete via deletedAt
          _applyRemoteDoc(entityType, change.doc.id, change.doc.data({ serverTimestamps: 'estimate' }));
          changed = true;
        });
        if (changed) {
          save(state);       // persist the merged result locally — does not re-push to Firestore
          _notifyChange();   // let app.js know it should re-render
        }
        _setSyncStatus(snap.metadata.hasPendingWrites ? 'pending' : 'synced');
      }, (err) => {
        console.error(`[Sync] listener error (${entityType}):`, err);
        _setSyncStatus('failed', err);
      });
    _fsUnsubscribers.push(unsub);
  }

  function _stopSyncInternal() {
    _fsUnsubscribers.forEach((unsub) => { try { unsub(); } catch (e) { /* already gone */ } });
    _fsUnsubscribers = [];
    _fsFamilyId = null;
    _setSyncStatus('idle');
  }

  // ── End Real Family Sync infrastructure ─────────────────────────────────────

  function save(state) {
    // intentionally NOT wrapped in try/catch here — if localStorage.setItem throws (e.g. quota
    // exceeded, Safari Private Browsing), the error propagates up to whoever called the DB write
    // method (addMedEntry, updateChild, etc.), which app.js catches to show a real failure toast
    // instead of silently claiming success. See app.js saveMed/saveTemp/saveKid/etc.
    // BUGFIX: key is derived from the state's OWN auth binding, never a shared constant —
    // this is what makes it impossible for one user's save() to land in another user's slot.
    localStorage.setItem(_keyFor(state.auth?.uid || null), JSON.stringify(state));
  }

  let state = load();

  return {
    uid,
    get: () => state,
    reset: () => {
      // Reset = intentional wipe of local data by the user.
      // Preserves auth binding so the same user stays logged in after reset.
      const preserved = { uid: state.auth?.uid || null, familyId: state.auth?.familyId || null };
      state = seed();
      state.auth = preserved;
      save(state);
      return state;
    },
    persist: () => save(state),

    // ── Stage B: Identity helpers ─────────────────────────────────────────────

    /* Returns the uid that owns the current local state, or null if anonymous. */
    ownerUid: () => state.auth?.uid || null,

    /* Returns the cached familyId, or null. */
    ownerFamilyId: () => state.auth?.familyId || null,

    /* Bind local state to a Firebase user after login/signup.
       BUGFIX (account-switch data loss): this used to just mutate state.auth in place and
       save() to the one shared key — so a second user's setAuth() overwrote the first
       user's data on disk. Now it resolves this uid's OWN storage key:
         1. that uid's own key already exists → load it (their real, current data).
         2. it doesn't exist yet, but the legacy pre-fix shared key's own auth.uid
            PROVABLY matches this exact uid → treat it as a one-time recovery of their
            data (never someone else's — the match check is what makes this safe).
         3. otherwise → brand-new blank state for this uid.
       Always writes to the new per-uid key FIRST; only removes the legacy key
       afterward, and only when it was confirmed to be this same user's data. */
    setAuth({ uid: newUid, familyId }) {
      let target = _loadKey(_keyFor(newUid));

      if (!target) {
        const legacy = _loadKey(KEY_PREFIX);
        target = (legacy && legacy.auth && legacy.auth.uid === newUid) ? legacy : seed();
      }

      target.auth = { uid: newUid, familyId: familyId || null };
      state = target;
      save(state); // writes to the per-uid key — the legacy key is untouched by this line

      const legacyNow = _loadKey(KEY_PREFIX);
      if (legacyNow && legacyNow.auth && legacyNow.auth.uid === newUid) {
        try { localStorage.removeItem(KEY_PREFIX); } catch (e) { /* best-effort cleanup only */ }
      }
    },

    /* Called on logout — zero out the auth binding and reset in-memory state
       so the next user sees a clean slate.
       Does NOT wipe localStorage data: this user's real data already lives safely
       under THEIR OWN key (madhom_v1_<uid> — every save() during their session wrote
       there, per the save() fix above), completely separate from any other uid's key.
       So there is nothing here that skipping save() needs to "protect" — blanking
       the in-memory state is enough; no other user's key is ever touched by this. */
    clearAuth() {
      // Blank the in-memory state — UI renders empty immediately
      state = seed();
      // auth stays null in the new seed — no uid binding.
      // We do NOT call save() here: there is nothing to persist for "no user",
      // and doing so would needlessly write to the legacy/anonymous key.
      _stopSyncInternal(); // stop listening to the previous family's Firestore data
    },

    // ── End Stage B ───────────────────────────────────────────────────────────

    addMedEntry(entry) {
      const _t = Date.now(); const full = { id: uid(), time: _t, createdAt: _t, updatedAt: _t, ...entry };
      state.medEntries.unshift(full);
      save(state);
      _pushToFirestore('medEntries', full);
      return full;
    },
    updateMedEntry(id, patch) {
      const e = state.medEntries.find((x) => x.id === id);
      if (e) { Object.assign(e, patch); e.updatedAt = Date.now(); }
      save(state);
      if (e) _pushToFirestore('medEntries', e);
    },
    deleteMedEntry(id) {
      // C1: soft-delete (tombstone) so Stage C2 can sync the deletion to the cloud.
      // UI must filter out entries with deletedAt set.
      const e = state.medEntries.find((x) => x.id === id);
      if (e) { e.deletedAt = Date.now(); e.updatedAt = Date.now(); }
      save(state);
      if (e) _pushToFirestore('medEntries', e);
    },
    addTempEntry(entry) {
      const _tt = Date.now(); const full = { id: uid(), time: _tt, createdAt: _tt, updatedAt: _tt, ...entry };
      state.tempEntries.unshift(full);
      save(state);
      _pushToFirestore('tempEntries', full);
    },
    updateTempEntry(id, patch) {
      const e = state.tempEntries.find((x) => x.id === id);
      if (e) { Object.assign(e, patch); e.updatedAt = Date.now(); }
      save(state);
      if (e) _pushToFirestore('tempEntries', e);
    },
    deleteTempEntry(id) {
      const e = state.tempEntries.find((x) => x.id === id);
      if (e) { e.deletedAt = Date.now(); e.updatedAt = Date.now(); }
      save(state);
      if (e) _pushToFirestore('tempEntries', e);
    },
    updateChild(id, patch) {
      const c = state.children.find((x) => x.id === id);
      if (c) {
        if (patch.weight !== undefined && patch.weight !== c.weight) patch.weightUpdatedAt = Date.now();
        Object.assign(c, patch);
        c.updatedAt = Date.now();
      }
      save(state);
      if (c) _pushToFirestore('children', c);
    },
    addChild(child) {
      const _now = Date.now();
      const full = { id: uid(), color: state.children.length % 2 ? 'a2' : 'a1', weightUpdatedAt: _now, createdAt: _now, updatedAt: _now, ...child };
      state.children.push(full);
      save(state);
      _pushToFirestore('children', full);
    },
    setSetting(key, value) {
      state.settings[key] = value;
      state.settings.updatedAt = Date.now();
      save(state);
    },

    // ── C1: medicines CRUD ──────────────────────────────────────────────────
    // Previously medicines was a plain string[]; now it's {id,name,createdAt,updatedAt}[].
    // These methods are the canonical way to add/update/remove medicines.
    // app.js direct mutations (state.medicines.push / includes) are replaced below.

    /* Add a medicine by name. No-op if a medicine with the same name (case-insensitive) exists.
       Returns the existing or new medicine object. */
    addMedicine(name) {
      const trimmed = name.trim();
      const existing = state.medicines.find((m) => m.name.toLowerCase() === trimmed.toLowerCase());
      if (existing) return existing;
      const _t = Date.now();
      const m = { id: uid(), name: trimmed, createdAt: _t, updatedAt: _t };
      state.medicines.push(m);
      save(state);
      _pushToFirestore('medicines', m);
      return m;
    },

    /* Soft-delete a medicine by id (tombstone). */
    deleteMedicine(id) {
      const m = state.medicines.find((x) => x.id === id);
      if (m) { m.deletedAt = Date.now(); m.updatedAt = Date.now(); }
      save(state);
      if (m) _pushToFirestore('medicines', m);
    },

    /* Returns visible (non-deleted) medicine names as a string[] — backward-compatible
       with all existing app.js code that reads state.medicines as strings. */
    medicineNames() {
      return state.medicines.filter((m) => !m.deletedAt).map((m) => m.name);
    },

    /* --- prescriptions: an active/past treatment for a specific child ---
       global array with a childId field on each record (not nested under the child), so queries
       like "all active prescriptions today" or "what's active for this child" stay simple filters.
       References the catalog by stable `productId`/`ingredientId` (not the display name), so a
       product's Hebrew label can change without breaking existing prescriptions.
       Only ever stores what's specific to THIS treatment (status, timing, reminder) — protocol
       defaults (intervalHours etc.) live in MEDICATION_CATALOG and are read from there, not copied.

       COURSE fields (isCourse: true):
         totalDays    — total days of treatment (e.g. 10)
         dosesPerDay  — doses per day (e.g. 2)
         doseLog      — [{at: timestamp, dose: number}] one entry per dose given
    */
    addPrescription(rx) {
      const _rxt = Date.now();
      const full = migrateRx({
        id: uid(),
        status: 'active',
        startAt: _rxt,
        createdAt: _rxt,
        updatedAt: _rxt,
        endAt: null,
        reminder: { on: true },
        ...rx,
      });
      state.prescriptions.unshift(full);
      save(state);
      _pushToFirestore('prescriptions', full);
      return full;
    },
    updatePrescription(id, patch) {
      const p = state.prescriptions.find((x) => x.id === id);
      if (p) { Object.assign(p, patch); p.updatedAt = Date.now(); }
      save(state);
      if (p) _pushToFirestore('prescriptions', p);
      return p || null;
    },
    deletePrescription(id) {
      const p = state.prescriptions.find((x) => x.id === id);
      if (p) { p.deletedAt = Date.now(); p.updatedAt = Date.now(); }
      save(state);
      if (p) _pushToFirestore('prescriptions', p);
    },

    /* Log a single dose for a COURSE prescription.
       Returns the updated prescription, or null if not found. */
    logCourseDose(rxId, doseAmount) {
      const p = state.prescriptions.find((x) => x.id === rxId);
      if (!p || !p.isCourse) return null;
      p.doseLog.push({ id: uid(), at: Date.now(), dose: doseAmount });
      p.updatedAt = Date.now();
      // auto-complete: if total doses reached, mark as completed
      const totalDoses = (p.totalDays || 0) * (p.dosesPerDay || 1);
      if (totalDoses > 0 && p.doseLog.length >= totalDoses) {
        p.status = 'completed';
        p.endAt = Date.now();
      }
      save(state);
      _pushToFirestore('prescriptions', p);
      return p;
    },

    /* Progress for a COURSE prescription (0–1 float, or null if not a course). */
    courseProgress(rxId) {
      const p = state.prescriptions.find((x) => x.id === rxId);
      if (!p || !p.isCourse) return null;
      const totalDoses = (p.totalDays || 0) * (p.dosesPerDay || 1);
      if (!totalDoses) return null;
      return Math.min(1, p.doseLog.length / totalDoses);
    },

    activePrescriptionsFor(childId) {
      return state.prescriptions.filter((p) => !p.deletedAt && p.childId === childId && p.status === 'active');
    },
    lastMedFor(childId) {
      return state.medEntries.filter((e) => !e.deletedAt && e.childId === childId && !e.isSupp).sort((a, b) => b.time - a.time)[0] || null;
    },
    lastTempFor(childId) {
      return state.tempEntries.filter((e) => e.childId === childId).sort((a, b) => b.time - a.time)[0] || null;
    },
    tempsFor(childId) {
      return state.tempEntries.filter((e) => e.childId === childId).sort((a, b) => b.time - a.time);
    },
    /* combined feed of meds + temps, newest first */
    feed(childId) {
      const meds = state.medEntries.map((e) => ({ ...e, kind: 'med' }));
      const temps = state.tempEntries.map((e) => ({ ...e, kind: 'temp' }));
      return meds.concat(temps)
        .filter((e) => !e.deletedAt && (!childId || e.childId === childId))
        .sort((a, b) => b.time - a.time);
    },
    /* night-window entries (22:00-06:00) in the last N hours, per child */
    nightSummary(childId, withinHours = 12) {
      const cutoff = Date.now() - withinHours * 3600 * 1000;
      const isNight = (t) => { const h = new Date(t).getHours(); return h >= 22 || h < 6; };
      const meds = state.medEntries.filter((e) => e.childId === childId && e.time >= cutoff && isNight(e.time));
      const temps = state.tempEntries.filter((e) => e.childId === childId && e.time >= cutoff && isNight(e.time));
      if (!meds.length && !temps.length) return null;
      const maxTemp = temps.length ? Math.max(...temps.map((t) => t.value)) : null;
      return { medCount: meds.length, maxTemp };
    },

    // ── Real Family Sync — public API ────────────────────────────────────────

    /* Start syncing this device's local data with the given family's Firestore data.
       Safe to call multiple times with the same familyId (no-ops if already active).
       Runs a one-time safe migration of existing local records, then subscribes to
       live updates for all 5 synced entity types. */
    initSync(familyId) {
      if (!familyId || _fsFamilyId === familyId) return; // already syncing this family, or nothing to sync
      _stopSyncInternal();
      _fsFamilyId = familyId;
      _migrateLocalToFirestore(familyId).catch((e) => console.error('[Sync] migration error:', e.message));
      SYNCED_COLLECTIONS.forEach((entityType) => _subscribeToCollection(familyId, entityType));
    },

    /* Stop all active Firestore listeners (called on logout, or before switching family). */
    stopSync() {
      _stopSyncInternal();
    },

    /* Current sync status: { state: 'idle'|'pending'|'synced'|'failed', error: string|null }.
       'idle' = sync not initialised yet. Never silently claims 'synced' without server confirmation. */
    getSyncStatus() {
      return { ..._syncStatus };
    },

    /* Register a callback fired whenever remote data changes local state (i.e. the other
       device made a change). Used by app.js to re-render promptly instead of waiting for
       the existing 60s polling interval. */
    onChange(cb) {
      _changeListeners.push(cb);
    },
  };
})();

