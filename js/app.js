const App = (() => {
  const AVATAR_GRADIENT = {
    a1: 'linear-gradient(135deg,#FFB6A3,#FF9F6B)',
    a2: 'linear-gradient(135deg,#7C6FF0,#9B8EFF)',
  };

  let medChildSel = null;
  let medMedicineSel = null;
  let tempChildSel = null;
  let histFilter = 'all';
  let editingKidId = null; // null = add mode
  let deferredInstallPrompt = null;

  /* ---------- add-to-home-screen detection ---------- */
  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }
  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  }
  function isAndroid() {
    return /Android/.test(navigator.userAgent);
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    const btn = document.getElementById('btn-install');
    if (btn) btn.style.display = 'block';
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    goto('screen-splash');
  });

  function renderLanding() {
    if (isStandalone()) { goto('screen-splash'); return; }
    document.getElementById('landing-ios').style.display = isIOS() ? 'block' : 'none';
    document.getElementById('landing-android').style.display = (isAndroid() || (!isIOS() && deferredInstallPrompt)) ? 'block' : 'none';
    document.getElementById('landing-desktop').style.display = (!isIOS() && !isAndroid() && !deferredInstallPrompt) ? 'block' : 'none';
    const btn = document.getElementById('btn-install');
    if (btn) btn.style.display = deferredInstallPrompt ? 'block' : (isAndroid() ? 'none' : 'none');
  }
  function installNow() {
    if (!deferredInstallPrompt) { toast('פתחו את תפריט הדפדפן ובחרו "התקן אפליקציה"'); return; }
    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.finally(() => { deferredInstallPrompt = null; });
  }
  function skipLanding() { goto('screen-splash'); }

  /* ---------- helpers ---------- */
  function nowHHMM() {
    const d = new Date();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function timeToToday(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d.getTime();
  }
  function formatClock(ts) {
    const d = new Date(ts);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function elapsedString(ts) {
    let diff = Math.max(0, Date.now() - ts);
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'ממש עכשיו';
    if (mins < 60) return `${mins} דקות`;
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    if (hrs < 24) return rem ? `${hrs} שעות ו־${rem} דק׳` : `${hrs} שעות`;
    const days = Math.floor(hrs / 24);
    return `${days} ${days === 1 ? 'יום' : 'ימים'}`;
  }
  function dayLabel(ts) {
    const d = new Date(ts), now = new Date();
    const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000);
    if (diffDays === 0) return 'היום';
    if (diffDays === 1) return 'אתמול';
    return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
  }
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 1800);
  }
  function childById(id) { return DB.get().children.find((c) => c.id === id); }

  /* ---------- navigation ---------- */
  function goto(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    if (id === 'screen-kids') renderKids();
  }
  function tab(id) {
    goto(id);
    document.querySelectorAll('.navitem').forEach((n) => n.classList.toggle('active', n.dataset.nav === id));
    if (id === 'screen-dash') renderDashboard();
    if (id === 'screen-hist') renderHistory();
    if (id === 'screen-temp') renderTemp();
  }
  function openSheet(id) { document.getElementById(id).classList.add('open'); }
  function closeSheet(id) { document.getElementById(id).classList.remove('open'); }

  /* ---------- pick-child screen ---------- */
  function renderPickList() {
    const wrap = document.getElementById('pick-list');
    const state = DB.get();
    wrap.innerHTML = state.children.map((c) => {
      const lastTemp = DB.lastTempFor(c.id);
      return `<div class="pick-card" onclick="App.tab('screen-dash')">
        <div class="pick-avatar" style="background:${AVATAR_GRADIENT[c.color]}">${c.emoji}</div>
        <div>
          <div class="pick-name">${c.name}</div>
          <div class="pick-meta">${c.weight} ק״ג${lastTemp ? ' · חום אחרון ' + lastTemp.value + '°' : ''}</div>
        </div>
      </div>`;
    }).join('');
  }

  /* ---------- dashboard ---------- */
  function renderDashboard() {
    const state = DB.get();
    document.getElementById('fam-name').textContent = state.family;
    document.getElementById('fam-sub').textContent = `${state.children.length} ילדים פעילים · מעקב חי`;

    const wrap = document.getElementById('dash-children');
    if (!state.children.length) {
      wrap.innerHTML = `<div class="empty-state"><div class="ic">👨‍👩‍👧‍👦</div><div class="t">עדיין אין ילדים באפליקציה</div><div class="s">אפשר להוסיף ילד/ה דרך הגדרות ← ניהול ילדים</div></div>`;
      return;
    }

    wrap.innerHTML = state.children.map((c) => {
      const lastMed = DB.lastMedFor(c.id);
      const lastTemp = DB.lastTempFor(c.id);
      const night = DB.nightSummary(c.id);
      const warn = lastTemp && lastTemp.value >= 38;

      const nightHtml = night ? `<div class="night-note">🌙 <span><b>הלילה:</b> ${c.name} ${night.medCount ? `קיבל/ה תרופה ${night.medCount === 1 ? 'פעם אחת' : night.medCount + ' פעמים'}` : ''}${night.medCount && night.maxTemp ? ', ' : ''}${night.maxTemp ? `חום מקסימלי ${night.maxTemp}°` : ''}.</span></div>` : '';

      return `${nightHtml}<div class="child-card">
        <div class="child-row">
          <div class="avatar" style="background:${AVATAR_GRADIENT[c.color]}">${c.emoji}</div>
          <div class="child-name">${c.name}</div>
          <div class="status-pill ${warn ? 'warn' : ''}">${warn ? 'חום מוגבר' : 'מעקב פעיל'}</div>
        </div>
        <div class="stat-grid">
          <div class="stat-box"><div class="stat-label">חום אחרון</div><div class="stat-value temp">${lastTemp ? lastTemp.value + '°' : '—'}</div></div>
          <div class="stat-box"><div class="stat-label">תרופה אחרונה</div><div class="stat-value">${lastMed ? lastMed.medicine : '—'}</div></div>
        </div>
        ${lastMed ? `<div class="elapsed-bar"><span class="t">ניתנה ב־${formatClock(lastMed.time)} · עברו</span><span class="v">${elapsedString(lastMed.time)}</span></div>` : ''}
      </div>`;
    }).join('');
  }

  /* ---------- add medication sheet ---------- */
  function openMedSheet() {
    const state = DB.get();
    medChildSel = state.children[0]?.id || null;
    medMedicineSel = state.medicines[0] || null;
    document.getElementById('med-child-chips').innerHTML = state.children.map((c) =>
      `<button type="button" class="chip ${c.id === medChildSel ? 'sel' : ''}" data-id="${c.id}" onclick="App.pickMedChild('${c.id}')">${c.emoji} ${c.name}</button>`).join('');
    document.getElementById('med-medicine-chips').innerHTML = state.medicines.map((m) =>
      `<button type="button" class="chip ${m === medMedicineSel ? 'sel' : ''}" onclick="App.pickMedMedicine('${m}')">${m}</button>`).join('') +
      `<button type="button" class="chip" onclick="App.addCustomMedicine()">+ אחרת</button>`;
    document.getElementById('med-time').value = nowHHMM();
    document.getElementById('med-dose').value = '';
    document.getElementById('med-note').value = '';
    openSheet('sheet-med');
  }
  function pickMedChild(id) {
    medChildSel = id;
    document.querySelectorAll('#med-child-chips .chip').forEach((el) => el.classList.toggle('sel', el.dataset.id === id));
  }
  function pickMedMedicine(name) {
    medMedicineSel = name;
    document.querySelectorAll('#med-medicine-chips .chip').forEach((el) => el.classList.toggle('sel', el.textContent === name));
  }
  function addCustomMedicine() {
    const name = prompt('שם התרופה:');
    if (!name) return;
    const state = DB.get();
    if (!state.medicines.includes(name)) { state.medicines.push(name); DB.persist(); }
    medMedicineSel = name;
    openMedSheet();
    pickMedMedicine(name);
  }
  function saveMed() {
    if (!medChildSel) { toast('אין ילד לבחור — הוסיפו ילד/ה קודם'); return; }
    DB.addMedEntry({
      childId: medChildSel,
      medicine: medMedicineSel || 'תרופה',
      dose: document.getElementById('med-dose').value.trim(),
      note: document.getElementById('med-note').value.trim(),
      time: timeToToday(document.getElementById('med-time').value || nowHHMM()),
    });
    closeSheet('sheet-med');
    toast('התרופה נשמרה ✓');
    renderDashboard();
  }

  /* ---------- history ---------- */
  function renderHistory() {
    const state = DB.get();
    document.getElementById('hist-filters').innerHTML =
      `<button type="button" class="chip ${histFilter === 'all' ? 'sel' : ''}" onclick="App.setHistFilter('all')">הכל</button>` +
      state.children.map((c) => `<button type="button" class="chip ${histFilter === c.id ? 'sel' : ''}" onclick="App.setHistFilter('${c.id}')">${c.emoji} ${c.name}</button>`).join('');

    const feed = DB.feed(histFilter === 'all' ? null : histFilter);
    const list = document.getElementById('hist-list');
    if (!feed.length) {
      list.innerHTML = `<div class="empty-state"><div class="ic">📭</div><div class="t">אין עדיין רשומות</div><div class="s">תרופות ומדידות שיתווספו יופיעו כאן</div></div>`;
      return;
    }
    let lastLabel = null;
    let html = '';
    feed.forEach((e) => {
      const label = dayLabel(e.time);
      if (label !== lastLabel) { html += `<div class="day-label">${label}</div>`; lastLabel = label; }
      const c = childById(e.childId);
      if (!c) return;
      const icon = e.kind === 'med' ? '💊' : '🌡️';
      const title = e.kind === 'med' ? e.medicine : `מדידת חום — ${e.value}°`;
      html += `<div class="hist-row">
        <div class="hist-time">${formatClock(e.time)}</div>
        <div class="hist-icon" style="background:${AVATAR_GRADIENT[c.color]}">${icon}</div>
        <div class="hist-main"><div class="hist-med">${title}</div><div class="hist-child">${c.name}${e.note ? ' · ' + e.note : ''}</div></div>
      </div>`;
    });
    list.innerHTML = html;
  }
  function setHistFilter(v) { histFilter = v; renderHistory(); }

  /* ---------- temperature ---------- */
  function renderTemp() {
    const state = DB.get();
    if (!tempChildSel && state.children.length) tempChildSel = state.children[0].id;
    document.getElementById('temp-filters').innerHTML = state.children.map((c) =>
      `<button type="button" class="chip ${tempChildSel === c.id ? 'sel' : ''}" onclick="App.setTempFilter('${c.id}')">${c.emoji} ${c.name}</button>`).join('');

    const readings = DB.tempsFor(tempChildSel).slice().reverse(); // oldest -> newest for chart
    const svg = document.getElementById('temp-svg');
    const cur = document.getElementById('temp-current');
    const lbl = document.getElementById('temp-current-lbl');

    if (!readings.length) {
      svg.innerHTML = '';
      cur.textContent = '--°';
      lbl.textContent = 'אין מדידות עדיין';
    } else {
      const last = readings[readings.length - 1];
      cur.textContent = last.value + '°';
      lbl.textContent = 'מדידה אחרונה · ' + formatClock(last.time);
      const vals = readings.map((r) => r.value);
      const min = Math.min(...vals, 36), max = Math.max(...vals, 39);
      const pad = 10;
      const w = 300, h = 100;
      const pts = readings.map((r, i) => {
        const x = readings.length > 1 ? pad + (i * (w - 2 * pad)) / (readings.length - 1) : w / 2;
        const y = h - pad - ((r.value - min) / (max - min || 1)) * (h - 2 * pad);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      });
      svg.innerHTML = `<polyline points="${pts.join(' ')}" fill="none" stroke="#FF8A70" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="${pts[pts.length - 1].split(',')[0]}" cy="${pts[pts.length - 1].split(',')[1]}" r="5" fill="#FF8A70"/>`;
    }

    document.getElementById('temp-list').innerHTML = readings.slice().reverse().map((r) =>
      `<div class="temp-row"><span>${formatClock(r.time)}</span><span class="v">${r.value}°</span></div>`).join('') ||
      `<div class="empty-state"><div class="ic">🌡️</div><div class="t">אין מדידות</div><div class="s">לחצו על "הוספת מדידה" כדי להתחיל</div></div>`;
  }
  function setTempFilter(id) { tempChildSel = id; renderTemp(); }

  function openTempSheet() {
    const state = DB.get();
    if (!tempChildSel && state.children.length) tempChildSel = state.children[0].id;
    document.getElementById('temp-child-chips').innerHTML = state.children.map((c) =>
      `<button type="button" class="chip ${c.id === tempChildSel ? 'sel' : ''}" data-id="${c.id}" onclick="App.pickTempChild('${c.id}')">${c.emoji} ${c.name}</button>`).join('');
    document.getElementById('temp-value').value = '';
    document.getElementById('temp-error').style.display = 'none';
    document.getElementById('temp-time').value = nowHHMM();
    openSheet('sheet-temp');
  }
  function pickTempChild(id) {
    tempChildSel = id;
    document.querySelectorAll('#temp-child-chips .chip').forEach((el) => el.classList.toggle('sel', el.dataset.id === id));
  }
  function saveTemp() {
    const val = parseFloat(document.getElementById('temp-value').value);
    const err = document.getElementById('temp-error');
    if (isNaN(val) || val < 30 || val > 43) { err.style.display = 'block'; return; }
    err.style.display = 'none';
    if (!tempChildSel) { toast('אין ילד לבחור — הוסיפו ילד/ה קודם'); return; }
    DB.addTempEntry({ childId: tempChildSel, value: val, time: timeToToday(document.getElementById('temp-time').value || nowHHMM()) });
    closeSheet('sheet-temp');
    toast('המדידה נשמרה ✓');
    renderTemp();
    renderDashboard();
  }

  /* ---------- children management ---------- */
  function renderKids() {
    const state = DB.get();
    document.getElementById('kids-list').innerHTML = state.children.map((c) =>
      `<div class="kid-card">
        <div class="avatar" style="background:${AVATAR_GRADIENT[c.color]}">${c.emoji}</div>
        <div><div class="child-name">${c.name}</div><div class="hist-child">${c.weight} ק״ג${c.birthYear ? ' · נולד/ה ' + c.birthYear : ''}</div></div>
        <button class="kid-edit" onclick="App.openEditKid('${c.id}')">עריכה</button>
      </div>`).join('') || `<div class="empty-state"><div class="ic">👶</div><div class="t">עדיין אין ילדים</div></div>`;
  }
  function openEditKid(id) {
    editingKidId = id;
    const title = document.getElementById('editkid-title');
    if (id) {
      const c = childById(id);
      title.textContent = 'עריכת פרטי ילד/ה';
      document.getElementById('kid-name').value = c.name;
      document.getElementById('kid-weight').value = c.weight;
      document.getElementById('kid-birth').value = c.birthYear || '';
    } else {
      title.textContent = 'הוספת ילד/ה';
      document.getElementById('kid-name').value = '';
      document.getElementById('kid-weight').value = '';
      document.getElementById('kid-birth').value = '';
    }
    openSheet('sheet-editkid');
  }
  function saveKid() {
    const name = document.getElementById('kid-name').value.trim();
    const weight = parseFloat(document.getElementById('kid-weight').value);
    const birthYear = document.getElementById('kid-birth').value ? parseInt(document.getElementById('kid-birth').value, 10) : null;
    if (!name) { toast('נא להזין שם'); return; }
    if (editingKidId) {
      DB.updateChild(editingKidId, { name, weight: isNaN(weight) ? 0 : weight, birthYear });
    } else {
      DB.addChild({ name, emoji: '🧒', weight: isNaN(weight) ? 0 : weight, birthYear });
    }
    closeSheet('sheet-editkid');
    toast('הפרטים נשמרו ✓');
    renderKids();
    renderDashboard();
    renderPickList();
  }

  /* ---------- settings ---------- */
  function renderSettings() {
    const on = DB.get().settings.notifications;
    document.getElementById('toggle-notif').classList.toggle('on', on);
  }
  function toggleNotif() {
    const on = !DB.get().settings.notifications;
    DB.setSetting('notifications', on);
    renderSettings();
  }

  /* ---------- clock ---------- */
  function tickClock() {
    document.getElementById('clock').textContent = nowHHMM();
  }

  function init() {
    renderLanding();
    renderPickList();
    renderDashboard();
    renderSettings();
    tickClock();
    setInterval(tickClock, 15000);
    setInterval(renderDashboard, 60000); // keep "elapsed" times fresh
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  return {
    goto, tab, openSheet, closeSheet,
    openMedSheet, pickMedChild, pickMedMedicine, addCustomMedicine, saveMed,
    setHistFilter, setTempFilter, openTempSheet, pickTempChild, saveTemp,
    openEditKid, saveKid, toggleNotif, init,
    installNow, skipLanding,
  };
})();

document.addEventListener('DOMContentLoaded', App.init);
