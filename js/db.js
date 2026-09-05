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
    },

    // ── End Stage B ───────────────────────────────────────────────────────────

    addMedEntry(entry) {
      const _t = Date.now(); const full = { id: uid(), time: _t, createdAt: _t, updatedAt: _t, ...entry };
      state.medEntries.unshift(full);
      save(state);
      return full;
    },
    updateMedEntry(id, patch) {
      const e = state.medEntries.find((x) => x.id === id);
      if (e) { Object.assign(e, patch); e.updatedAt = Date.now(); }
      save(state);
    },
    deleteMedEntry(id) {
      // C1: soft-delete (tombstone) so Stage C2 can sync the deletion to the cloud.
      // UI must filter out entries with deletedAt set.
      const e = state.medEntries.find((x) => x.id === id);
      if (e) { e.deletedAt = Date.now(); e.updatedAt = Date.now(); }
      save(state);
    },
    addTempEntry(entry) {
      const _tt = Date.now(); state.tempEntries.unshift({ id: uid(), time: _tt, createdAt: _tt, updatedAt: _tt, ...entry });
      save(state);
    },
    updateTempEntry(id, patch) {
      const e = state.tempEntries.find((x) => x.id === id);
      if (e) { Object.assign(e, patch); e.updatedAt = Date.now(); }
      save(state);
    },
    deleteTempEntry(id) {
      const e = state.tempEntries.find((x) => x.id === id);
      if (e) { e.deletedAt = Date.now(); e.updatedAt = Date.now(); }
      save(state);
    },
    updateChild(id, patch) {
      const c = state.children.find((x) => x.id === id);
      if (c) {
        if (patch.weight !== undefined && patch.weight !== c.weight) patch.weightUpdatedAt = Date.now();
        Object.assign(c, patch);
        c.updatedAt = Date.now();
      }
      save(state);
    },
    addChild(child) {
      const _now = Date.now();
      state.children.push({ id: uid(), color: state.children.length % 2 ? 'a2' : 'a1', weightUpdatedAt: _now, createdAt: _now, updatedAt: _now, ...child });
      save(state);
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
      return m;
    },

    /* Soft-delete a medicine by id (tombstone). */
    deleteMedicine(id) {
      const m = state.medicines.find((x) => x.id === id);
      if (m) { m.deletedAt = Date.now(); m.updatedAt = Date.now(); }
      save(state);
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
      return full;
    },
    updatePrescription(id, patch) {
      const p = state.prescriptions.find((x) => x.id === id);
      if (p) { Object.assign(p, patch); p.updatedAt = Date.now(); }
      save(state);
      return p || null;
    },
    deletePrescription(id) {
      const p = state.prescriptions.find((x) => x.id === id);
      if (p) { p.deletedAt = Date.now(); p.updatedAt = Date.now(); }
      save(state);
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
  };
})();

