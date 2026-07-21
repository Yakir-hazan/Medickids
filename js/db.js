/* Simple localStorage-backed data layer.
   Swap-in point for IndexedDB later without touching app.js's public API. */
const DB = (() => {
  const KEY = 'madhom_v1';

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function seed() {
    const now = Date.now();
    const h = (n) => now - n * 3600 * 1000;
    const children = [
      { id: 'c1', name: 'נויה', emoji: '👧', color: 'a1', weight: 18, birthYear: 2021 },
      { id: 'c2', name: 'שירה', emoji: '👦', color: 'a2', weight: 24, birthYear: 2019 },
    ];
    const medEntries = [
      { id: uid(), childId: 'c1', medicine: 'אקמול ילדים', dose: '', note: '', time: h(2.25) },
      { id: uid(), childId: 'c1', medicine: 'אקמול ילדים', dose: '', note: 'אחרי אמבטיה פושרת', time: h(23.5) },
      { id: uid(), childId: 'c2', medicine: 'נורופן', dose: '', note: '', time: h(13.5) },
    ];
    const tempEntries = [
      { id: uid(), childId: 'c1', value: 38.5, time: h(2.35) },
      { id: uid(), childId: 'c1', value: 38.9, time: h(5.6) },
      { id: uid(), childId: 'c1', value: 38.2, time: h(9.6) },
      { id: uid(), childId: 'c1', value: 38.7, time: h(19.5) },
      { id: uid(), childId: 'c2', value: 37.1, time: h(3.2) },
    ];
    return {
      family: 'משפחת כהן',
      children,
      medicines: ['אקמול ילדים', 'נורופן'],
      medEntries,
      tempEntries,
      settings: { notifications: true },
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) { const s = seed(); save(s); return s; }
      return JSON.parse(raw);
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
      state.medEntries.unshift({ id: uid(), time: Date.now(), ...entry });
      save(state);
    },
    addTempEntry(entry) {
      state.tempEntries.unshift({ id: uid(), time: Date.now(), ...entry });
      save(state);
    },
    updateChild(id, patch) {
      const c = state.children.find((x) => x.id === id);
      if (c) Object.assign(c, patch);
      save(state);
    },
    addChild(child) {
      state.children.push({ id: uid(), color: state.children.length % 2 ? 'a2' : 'a1', ...child });
      save(state);
    },
    setSetting(key, value) {
      state.settings[key] = value;
      save(state);
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
