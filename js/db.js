/* Simple localStorage-backed data layer.
   Swap-in point for IndexedDB later without touching app.js's public API. */
const DB = (() => {
  const KEY = 'madhom_v1';

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function seed() {
    return {
      family: '',
      children: [],
      medicines: ['אקמול ילדים', 'נורופן', 'נובימול', 'ויטמין D'],
      medEntries: [],
      tempEntries: [],
      prescriptions: [], // active/past treatments (e.g. "daily vitamin D reminder", future: antibiotic courses)
      settings: { notifications: false },
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) { const s = seed(); save(s); return s; }
      // merge: any top-level field added to seed() since this user last saved (e.g. `prescriptions`)
      // gets its default value, without touching the user's existing data
      const merged = { ...seed(), ...JSON.parse(raw) };
      return merged;
    } catch (e) {
      const s = seed(); save(s); return s;
    }
  }

  function save(state) {
    localStorage.setItem(KEY, JSON.stringify(state));
  }

  let state = load();

  return {
    uid,
    get: () => state,
    reset: () => { state = seed(); save(state); return state; },
    persist: () => save(state),

    addMedEntry(entry) {
      const full = { id: uid(), time: Date.now(), ...entry };
      state.medEntries.unshift(full);
      save(state);
      return full;
    },
    updateMedEntry(id, patch) {
      const e = state.medEntries.find((x) => x.id === id);
      if (e) Object.assign(e, patch);
      save(state);
    },
    deleteMedEntry(id) {
      state.medEntries = state.medEntries.filter((x) => x.id !== id);
      save(state);
    },
    addTempEntry(entry) {
      state.tempEntries.unshift({ id: uid(), time: Date.now(), ...entry });
      save(state);
    },
    updateTempEntry(id, patch) {
      const e = state.tempEntries.find((x) => x.id === id);
      if (e) Object.assign(e, patch);
      save(state);
    },
    deleteTempEntry(id) {
      state.tempEntries = state.tempEntries.filter((x) => x.id !== id);
      save(state);
    },
    updateChild(id, patch) {
      const c = state.children.find((x) => x.id === id);
      if (c) {
        if (patch.weight !== undefined && patch.weight !== c.weight) patch.weightUpdatedAt = Date.now();
        Object.assign(c, patch);
      }
      save(state);
    },
    addChild(child) {
      state.children.push({ id: uid(), color: state.children.length % 2 ? 'a2' : 'a1', weightUpdatedAt: Date.now(), ...child });
      save(state);
    },
    setSetting(key, value) {
      state.settings[key] = value;
      save(state);
    },
    /* --- prescriptions: an active/past treatment for a specific child (e.g. daily vitamin D) ---
       global array with a childId field on each record (not nested under the child), so queries
       like "all active prescriptions today" or "what's active for this child" stay simple filters.
       References the catalog by stable `productId`/`ingredientId` (not the display name), so a
       product's Hebrew label can change without breaking existing prescriptions.
       Only ever stores what's specific to THIS treatment (status, timing, reminder) — protocol
       defaults (intervalHours etc.) live in MEDICATION_CATALOG and are read from there, not copied. */
    addPrescription(rx) {
      const full = {
        id: uid(),
        status: 'active', // 'active' | 'completed' | 'cancelled'
        startAt: Date.now(),
        endAt: null,
        reminder: { on: true },
        ...rx,
      };
      state.prescriptions.unshift(full);
      save(state);
      return full;
    },
    updatePrescription(id, patch) {
      const p = state.prescriptions.find((x) => x.id === id);
      if (p) Object.assign(p, patch);
      save(state);
      return p || null;
    },
    activePrescriptionsFor(childId) {
      return state.prescriptions.filter((p) => p.childId === childId && p.status === 'active');
    },
    lastMedFor(childId) {
      return state.medEntries.filter((e) => e.childId === childId).sort((a, b) => b.time - a.time)[0] || null;
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
        .filter((e) => !childId || e.childId === childId)
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


