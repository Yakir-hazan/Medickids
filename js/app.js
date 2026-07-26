const App = (() => {
  /* ---------- flow constants ---------- */
  /* ⚠️ CLAUDE: bump APP_VERSION on EVERY push to this repo — and bump the -vNN suffix of
     CACHE_NAME in sw.js at the same time (they don't need matching text, just both incremented
     together). This value is shown to the user in Settings and is what "בדוק אם יש עדכון"
     relies on to prove a new version actually loaded. Forgetting to bump it breaks both.
     Beta scheme: 1.0.0-beta.2 → 1.0.0-beta.2 → ... → 1.0.0 once out of beta. */
  const APP_VERSION = '1.0.0-beta.14';
  const SPLASH_DURATION_RETURNING = 1500; // ms — short splash for returning users
  const SPLASH_DURATION_NEW       = 2200; // ms — slightly longer for new users

  const AVATAR_GRADIENT = {
    a1: 'linear-gradient(135deg,#FFB6A3,#FF9F6B)',
    a2: 'linear-gradient(135deg,#7C6FF0,#9B8EFF)',
  };

  let medChildSel = null;
  let medMedicineSel = null;
  let tempChildSel = null;
  let histFilter = 'all';
  let editMedEntryId = null;
  let doseReminderMode = 'auto'; // 'auto' | 'custom' — reminder timing for the new dose being logged
  let editTempEntryId = null;
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
    showSplash();
  });

  function renderLanding() {
    if (isStandalone()) { showSplash(); return; }
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
  function skipLanding() { showSplash(); }

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
  function showSplash() {
    goto('screen-splash');
    animateSplashThermo();
    // בקש רשות התראות OneSignal — רק ב-PWA מותקן (standalone)
    if (isStandalone()) {
      window.OneSignalDeferred = window.OneSignalDeferred || [];
      OneSignalDeferred.push(function(OneSignal) {
        OneSignal.Notifications.requestPermission();
      });
    }
  }

  /* ---------- splash thermometer animation ---------- */
  let splashAnimId = null;
  function animateSplashThermo() {
    const mercuryEl = document.getElementById('splash-mercury');
    const tempEl = document.getElementById('splash-temp');
    const subEl = document.getElementById('splash-loading-sub');
    if (!mercuryEl || !tempEl || !subEl) return;
    if (splashAnimId) cancelAnimationFrame(splashAnimId);

    const MIN_TEMP = 34.0, MAX_TEMP = 38.5, FULL_RANGE = 8; // tube scale spans 34°–42°; mercury only rises to 38.5° on it
    const TUBE_BOTTOM = 250, TUBE_H = 236;
    const DURATION = 1300; // finishes comfortably before the shortest auto-nav timeout (1500ms)
    const messages = [[35.0, 'טוען נתונים...'], [36.2, 'בודק עדכונים...'], [37.4, 'כמעט מוכן...']];
    let msgIdx = 0;
    let startTime = null;

    mercuryEl.setAttribute('height', 0);
    mercuryEl.setAttribute('y', TUBE_BOTTOM);
    tempEl.textContent = MIN_TEMP.toFixed(1) + '°C';
    subEl.textContent = 'טוען...';

    function tempToHeight(t) { return ((t - MIN_TEMP) / FULL_RANGE) * TUBE_H; }
    function easeInOut(t) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }

    function step(ts) {
      if (!startTime) startTime = ts;
      const progress = Math.min((ts - startTime) / DURATION, 1);
      const currentTemp = MIN_TEMP + easeInOut(progress) * (MAX_TEMP - MIN_TEMP);
      const h = tempToHeight(currentTemp);
      mercuryEl.setAttribute('y', TUBE_BOTTOM - h);
      mercuryEl.setAttribute('height', h);
      tempEl.textContent = currentTemp.toFixed(1) + '°C';
      while (msgIdx < messages.length && currentTemp >= messages[msgIdx][0]) {
        subEl.textContent = messages[msgIdx][1];
        msgIdx++;
      }
      if (progress < 1) splashAnimId = requestAnimationFrame(step);
      else { subEl.textContent = ''; splashAnimId = null; }
    }
    splashAnimId = requestAnimationFrame(step);
  }

  function tab(id) {
    goto(id);
    document.querySelectorAll('.navitem').forEach((n) => n.classList.toggle('active', n.dataset.nav === id));
    if (id === 'screen-dash') renderDashboard();
    if (id === 'screen-hist') renderHistory();
    if (id === 'screen-temp') renderTemp();
  }
  function openSheet(id) { document.getElementById(id).classList.add('open'); }
  function closeSheet(id) {
    document.getElementById(id).classList.remove('open');
    if (id === 'sheet-med') editMedEntryId = null;
    if (id === 'sheet-temp') editTempEntryId = null;
  }

  /* ---------- pick-child screen ---------- */
  function renderPickList() {
    const wrap = document.getElementById('pick-list');
    const state = DB.get();
    if (!state.children.length) {
      wrap.innerHTML = `<div class="empty-state"><div class="ic">👶</div><div class="t">עדיין לא הוספת ילדים</div><div class="s">אפשר להוסיף ילד/ה עכשיו</div></div>
        <button class="btn-primary" onclick="App.goto('screen-kids')">➕ הוספת ילד/ה</button>`;
      return;
    }
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
  /* one prioritized, actionable line per child — fever alert > dose timing > stale weight.
     Only ever returns ONE message so the dashboard stays calm, not noisy. */
  function smartInsight(c) {
    const now = Date.now();
    const temps = DB.tempsFor(c.id); // newest first

    // 1) fever — only interrupt with an alert when it's actually urgent
    if (temps.length && temps[0].value >= 38) {
      const latest = temps[0];
      let feverStart = latest.time;
      for (let i = 1; i < temps.length; i++) {
        if (temps[i].value >= 38) feverStart = temps[i].time; else break;
      }
      const feverHours = (now - feverStart) / 3600000;
      if (latest.value >= 39.5) {
        return { level: 'alert', icon: '🚨', text: `החום הגיע ל־${latest.value}° — כדאי לשקול פנייה לרופא/ה.` };
      }
      if (feverHours >= 24) {
        return { level: 'alert', icon: '🌡️', text: `החום נמשך כבר ${Math.floor(feverHours)} שעות — כדאי לשקול פנייה לרופא/ה.` };
      }
    }

    // 2) dose timing — reuses the same DOSE_DB intervals as the dose calculator, so the two never contradict each other
    const lastMed = DB.lastMedFor(c.id);
    if (lastMed) {
      const drugKey = Object.keys(DOSE_DB).find((k) => _matchesDrug(lastMed.medicine, k));
      const drug = drugKey ? DOSE_DB[drugKey] : null;
      if (drug && drug.intervalHours != null) {
        const hoursSince = (now - lastMed.time) / 3600000;
        const remain = drug.intervalHours - hoursSince;
        if (remain > 0) {
          const remainLabel = remain >= 1 ? `${Math.ceil(remain)} שעות` : `${Math.max(1, Math.round(remain * 60))} דקות`;
          return { level: 'info', icon: '⏱️', text: `אפשר לתת מנה נוספת של ${lastMed.medicine} בעוד כ־${remainLabel}.` };
        }
        return { level: 'ok', icon: '✅', text: `עברו ${elapsedString(lastMed.time)} מאז ${lastMed.medicine} — אפשר לתת מנה נוספת אם צריך.` };
      }
      return { level: 'info', icon: '💊', text: `עברו ${elapsedString(lastMed.time)} מאז ${lastMed.medicine}.` };
    }

    // 3) stale weight — lowest priority, and only once we actually know when it was last set
    if (c.weightUpdatedAt && (now - c.weightUpdatedAt) > 180 * 24 * 3600000) {
      const months = Math.floor((now - c.weightUpdatedAt) / (30 * 24 * 3600000));
      return { level: 'info', icon: '⚖️', text: `המשקל לא עודכן כבר ${months} חודשים — מינון מדויק דורש משקל עדכני.` };
    }

    return null;
  }

  let heroState = { type: 'calm', childId: null }; // remembers what the hero card currently represents, for heroClick()

  function renderDashboard() {
    const state = DB.get();
    const now = Date.now();

    // ---------- header ----------
    const hour = new Date().getHours();
    const timeGreet = hour < 5 ? 'לילה טוב' : hour < 12 ? 'בוקר טוב' : hour < 17 ? 'צהריים טובים' : hour < 21 ? 'ערב טוב' : 'לילה טוב';
    const famName = state.family ? `משפחת ${state.family}` : '';
    document.getElementById('dash-greeting').textContent = famName ? `${timeGreet}, ${famName} 👋` : `${timeGreet} 👋`;

    // ---------- empty state ----------
    const wrap = document.getElementById('dash-children');
    if (!state.children.length) {
      wrap.innerHTML = `<div class="empty-state"><div class="ic">👨‍👩‍👧‍👦</div><div class="t">עדיין אין ילדים באפליקציה</div><div class="s">הוסיפו ילד/ה דרך הגדרות ← ניהול ילדים</div></div>`;
      document.getElementById('dash-title').textContent = 'ברוכים הבאים ל-Medickids';
      document.getElementById('dash-updated').style.display = 'none';
      document.getElementById('dash-hero').style.display = 'none';
      document.getElementById('dash-fam-summary').style.display = 'none';
      document.getElementById('dash-timeline').style.display = 'none';
      document.getElementById('dash-insight').style.display = 'none';
      return;
    }
    document.getElementById('dash-hero').style.display = '';

    // ---------- compute per-child data ----------
    const childData = state.children.map((c) => {
      const lastMed = DB.lastMedFor(c.id);
      const lastTemp = DB.lastTempFor(c.id);
      const hasFever = lastTemp && lastTemp.value >= 38;

      // next dose countdown
      let nextDoseMs = null;
      let nextDrugName = null;
      if (lastMed) {
        const drugKey = Object.keys(DOSE_DB).find((k) => _matchesDrug(lastMed.medicine, k));
        const drug = drugKey ? DOSE_DB[drugKey] : null;
        if (drug && drug.intervalHours) {
          const readyAt = lastMed.time + drug.intervalHours * 3600000;
          if (readyAt > now) { nextDoseMs = readyAt - now; nextDrugName = lastMed.medicine; }
        }
      }

      // mood
      let mood = '😊';
      if (hasFever && lastTemp.value >= 39) mood = '😓';
      else if (hasFever) mood = '🤒';

      return { c, lastMed, lastTemp, hasFever, nextDoseMs, nextDrugName, mood };
    });

    // ---------- title ----------
    const anyFever = childData.some((d) => d.hasFever);
    document.getElementById('dash-title').textContent = anyFever ? 'מה קורה הלילה?' : 'מה קורה עכשיו?';

    // ---------- header: last updated ----------
    const latestEvent = DB.feed(null)[0] || null;
    const updatedEl = document.getElementById('dash-updated');
    if (latestEvent) {
      updatedEl.textContent = `עודכן לפני ${elapsedString(latestEvent.time)}`;
      updatedEl.style.display = '';
    } else {
      updatedEl.style.display = 'none';
    }

    // ---------- dynamic hero card — priority: fever > dose timing > stale weight > calm ----------
    const hero = document.getElementById('dash-hero');

    // worst fever across all children
    const feverChild = childData
      .filter((d) => d.hasFever)
      .sort((a, b) => b.lastTemp.value - a.lastTemp.value)[0] || null;

    // most urgent pending dose across all children
    const urgentDose = childData
      .filter((d) => d.nextDoseMs !== null)
      .sort((a, b) => a.nextDoseMs - b.nextDoseMs)[0] || null;

    // most stale weight across all children
    const staleWeight = state.children
      .filter((c) => c.weightUpdatedAt && (now - c.weightUpdatedAt) > 180 * 24 * 3600000)
      .sort((a, b) => a.weightUpdatedAt - b.weightUpdatedAt)[0] || null;

    if (feverChild) {
      heroState = { type: 'fever', childId: feverChild.c.id };
      hero.className = 'hero-card fever';
      hero.innerHTML = `
        <div class="hero-top">
          <div class="hero-ic">${feverChild.lastTemp.value >= 39.5 ? '🔥' : '🌡️'}</div>
          <div style="flex:1;">
            <div class="hero-label">שימו לב</div>
            <div class="hero-main">ל${feverChild.c.name} יש חום גבוה</div>
            <div class="hero-sub">מדדתם לפני ${elapsedString(feverChild.lastTemp.time)}</div>
          </div>
          <div class="hero-timer">${feverChild.lastTemp.value}°</div>
        </div>`;
    } else if (urgentDose) {
      heroState = { type: 'med', childId: urgentDose.c.id };
      const totalMin = Math.ceil(urgentDose.nextDoseMs / 60000);
      const hh = String(Math.floor(totalMin / 60)).padStart(2, '0');
      const mm = String(totalMin % 60).padStart(2, '0');
      hero.className = 'hero-card med';
      hero.innerHTML = `
        <div class="hero-top">
          <div class="hero-ic">⏰</div>
          <div style="flex:1;">
            <div class="hero-label">הפעולה הבאה</div>
            <div class="hero-main">אפשר לתת שוב ${urgentDose.nextDrugName} ל${urgentDose.c.name} בעוד</div>
            <div class="hero-sub">מנה אחרונה ב־${formatClock(urgentDose.lastMed.time)}</div>
          </div>
          <div class="hero-timer">${hh}:${mm}</div>
        </div>`;
    } else if (staleWeight) {
      heroState = { type: 'weight', childId: staleWeight.id };
      const months = Math.floor((now - staleWeight.weightUpdatedAt) / (30 * 24 * 3600000));
      hero.className = 'hero-card weight';
      hero.innerHTML = `
        <div class="hero-top">
          <div class="hero-ic">⚖️</div>
          <div style="flex:1;">
            <div class="hero-label">תזכורת</div>
            <div class="hero-main">כדאי לעדכן משקל ל${staleWeight.name}</div>
            <div class="hero-sub">עברו ${months} חודשים מאז העדכון האחרון</div>
          </div>
        </div>`;
    } else {
      heroState = { type: 'calm', childId: null };
      const latestTemp = childData
        .filter((d) => d.lastTemp)
        .sort((a, b) => b.lastTemp.time - a.lastTemp.time)[0] || null;
      hero.className = 'hero-card calm';
      hero.innerHTML = `
        <div class="hero-top">
          <div class="hero-ic">🌙</div>
          <div style="flex:1;">
            <div class="hero-label">הכול רגוע</div>
            <div class="hero-main">אין פעולות דחופות כרגע</div>
            ${latestTemp ? `<div class="hero-sub">המדידה האחרונה: ${latestTemp.lastTemp.value}°</div>` : ''}
          </div>
        </div>`;
    }

    // ---------- family summary — humanized chips ----------
    const famSummary = document.getElementById('dash-fam-summary');
    const medTodayCount = state.medEntries.filter((e) => {
      const d = new Date(e.time); const n = new Date();
      return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
    }).length;
    if (state.children.length > 1) {
      const chips = childData.map(({ c, hasFever }) =>
        hasFever
          ? `<div class="fam-chip warn">🌡️ ${c.name} עם חום</div>`
          : `<div class="fam-chip ok">🙂 ${c.name} מרגיש/ה טוב</div>`
      ).join('') + (medTodayCount ? `<div class="fam-chip">💊 ${medTodayCount} מנות היום</div>` : '');
      famSummary.innerHTML = `
        <div class="fam-top">
          <span class="fam-ic">👨‍👩‍👧‍👦</span>
          <span class="fam-title">${state.children.length} ילדים</span>
        </div>
        <div class="fam-chips">${chips}</div>`;
      famSummary.style.display = '';
    } else {
      famSummary.style.display = 'none';
    }

    // ---------- child cards — row based ----------
    wrap.innerHTML = childData.map(({ c, lastMed, lastTemp, hasFever, nextDoseMs, nextDrugName, mood }) => {
      const cardClass = hasFever ? ' warm' : '';
      const moodText = hasFever ? '🌡️ עם חום כרגע' : '🙂 רגוע';

      let tempRow = '';
      if (lastTemp) {
        tempRow = `<div class="crow">
          <div class="crow-ic">🌡️</div>
          <div class="crow-body">
            <div class="crow-val${hasFever ? ' fever' : ''}">${lastTemp.value}°</div>
            <div class="crow-lbl">מדידה אחרונה: לפני ${elapsedString(lastTemp.time)}</div>
          </div>
        </div>`;
      }

      let medRow = '';
      if (lastMed) {
        medRow = `<div class="crow">
          <div class="crow-ic">💊</div>
          <div class="crow-body">
            <div class="crow-val">${lastMed.medicine}</div>
            <div class="crow-lbl">ניתן לפני ${elapsedString(lastMed.time)}</div>
          </div>
          <div class="crow-time">${formatClock(lastMed.time)}</div>
        </div>`;
      }

      let canGiveHtml = '';
      if (nextDoseMs !== null) {
        const totalMin = Math.ceil(nextDoseMs / 60000);
        const hh = String(Math.floor(totalMin / 60)).padStart(2, '0');
        const mm = String(totalMin % 60).padStart(2, '0');
        canGiveHtml = `<div class="can-give-bar warn-bar">⏱️ אפשר לתת שוב ${nextDrugName} בעוד ${hh}:${mm}</div>`;
      } else if (lastMed) {
        canGiveHtml = `<div class="can-give-bar ok-bar">✅ אפשר לתת מנה נוספת אם צריך</div>`;
      }

      const emptyRow = (!tempRow && !medRow)
        ? `<div class="crow"><div class="crow-ic">✨</div><div class="crow-body"><div class="crow-lbl">אין נתונים עדיין היום</div></div></div>`
        : '';

      return `<div class="child-card${cardClass}">
        <div class="child-top" onclick="App.openEditKid('${c.id}')">
          <div class="avatar" style="background:${AVATAR_GRADIENT[c.color]}">${c.emoji}</div>
          <div class="child-info">
            <div class="child-name">${c.name}</div>
            <div class="child-mood">${moodText}</div>
          </div>
          <div class="child-edit-hint">עריכה ›</div>
        </div>
        ${tempRow}
        ${tempRow && medRow ? '<div class="child-divider"></div>' : ''}
        ${medRow}
        ${emptyRow}
        ${canGiveHtml}
      </div>`;
    }).join('');

    // ---------- timeline (last 3 events) ----------
    const feed = DB.feed(null).slice(0, 3);
    const tlCard = document.getElementById('dash-timeline');
    if (feed.length) {
      document.getElementById('dash-tl-rows').innerHTML = feed.map((e) => {
        const child = state.children.find((c) => c.id === e.childId);
        const childName = child ? child.name : '';
        const ic = e.kind === 'med' ? '💊' : '🌡️';
        const txt = e.kind === 'med' ? `${e.medicine}${e.dose ? ' ' + e.dose : ''}` : `${e.value}°`;
        return `<div class="tl-row">
          <div class="tl-time">${formatClock(e.time)}</div>
          <div class="tl-ic">${ic}</div>
          <div class="tl-txt">${txt}</div>
          <div class="tl-child">${childName}</div>
        </div>`;
      }).join('');
      tlCard.style.display = '';
    } else {
      tlCard.style.display = 'none';
    }

    // ---------- insight (first child with one) ----------
    const insightEl = document.getElementById('dash-insight');
    let shownInsight = null;
    for (const { c } of childData) {
      const ins = smartInsight(c);
      if (ins) { shownInsight = ins; break; }
    }
    if (shownInsight) {
      document.getElementById('dash-insight-text').textContent = shownInsight.text;
      insightEl.style.display = '';
    } else {
      insightEl.style.display = 'none';
    }
  }

  /* ---------- add medication sheet ---------- */
  function openMedSheet(entryId) {
    const state = DB.get();
    editMedEntryId = entryId || null;
    const entry = entryId ? state.medEntries.find((e) => e.id === entryId) : null;
    medChildSel = entry ? entry.childId : (state.children[0]?.id || null);
    medMedicineSel = entry ? entry.medicine : (state.medicines[0] || null);
    document.getElementById('med-child-chips').innerHTML = state.children.map((c) =>
      `<button type="button" class="chip ${c.id === medChildSel ? 'sel' : ''}" data-id="${c.id}" onclick="App.pickMedChild('${c.id}')">${c.emoji} ${c.name}</button>`).join('');
    document.getElementById('med-medicine-chips').innerHTML = state.medicines.map((m) =>
      `<button type="button" class="chip ${m === medMedicineSel ? 'sel' : ''}" onclick="App.pickMedMedicine('${m}')">${m}</button>`).join('') +
      `<button type="button" class="chip" onclick="App.addCustomMedicine()">+ אחרת</button>`;
    document.getElementById('med-time').value = entry ? formatClock(entry.time) : nowHHMM();
    document.getElementById('med-dose').value = entry ? (entry.dose || '') : '';
    document.getElementById('med-note').value = entry ? (entry.note || '') : '';
    document.getElementById('med-sheet-title').textContent = entry ? 'עריכת תרופה' : 'נתתי תרופה';
    document.getElementById('med-delete-btn').style.display = entry ? '' : 'none';

    // reminder controls — only relevant when logging a NEW dose, not when editing an old entry
    const remLabel = document.getElementById('med-reminder-label');
    const remChips = document.getElementById('med-reminder-chips');
    const remCustom = document.getElementById('med-reminder-custom');
    if (entry) {
      remLabel.style.display = 'none';
      remChips.style.display = 'none';
      remCustom.style.display = 'none';
    } else {
      doseReminderMode = 'auto';
      remCustom.value = '';
      remCustom.style.display = 'none';
      remLabel.style.display = '';
      remChips.style.display = '';
      _renderReminderChips();
    }
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
  /* ---------- dose reminder push scheduling ---------- */
  function _renderReminderChips() {
    const box = document.getElementById('med-reminder-chips');
    if (!box) return;
    box.innerHTML = `
      <button type="button" class="chip ${doseReminderMode === 'auto' ? 'sel' : ''}" onclick="App.pickReminderMode('auto')">⏱️ אוטומטי (לפי מרווח התרופה)</button>
      <button type="button" class="chip ${doseReminderMode === 'custom' ? 'sel' : ''}" onclick="App.pickReminderMode('custom')">🕐 זמן מותאם אישית</button>`;
  }
  function _toDatetimeLocal(ms) {
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function pickReminderMode(mode) {
    doseReminderMode = mode;
    _renderReminderChips();
    const customInput = document.getElementById('med-reminder-custom');
    if (mode === 'custom') {
      customInput.style.display = '';
      if (!customInput.value) {
        // prefill with the automatic guess so the user only has to tweak it, not start from scratch
        const drugKey = Object.keys(DOSE_DB).find((k) => _matchesDrug(medMedicineSel, k));
        const drug = drugKey ? DOSE_DB[drugKey] : null;
        const baseTime = timeToToday(document.getElementById('med-time').value || nowHHMM());
        const guess = baseTime + (drug && drug.intervalHours != null ? drug.intervalHours : 4) * 3600000;
        customInput.value = _toDatetimeLocal(guess);
      }
    } else {
      customInput.style.display = 'none';
    }
  }
  function scheduleDoseReminder(entry, customReadyAt) {
    if (!entry || !DB.get().settings.notifications) return; // user opted out — don't schedule
    let readyAt = customReadyAt;
    if (readyAt == null) {
      const drugKey = Object.keys(DOSE_DB).find((k) => _matchesDrug(entry.medicine, k));
      const drug = drugKey ? DOSE_DB[drugKey] : null;
      if (!drug || drug.intervalHours == null) return; // no known interval and no manual time — nothing to schedule
      readyAt = entry.time + drug.intervalHours * 3600000;
    }
    if (readyAt <= Date.now()) return; // time already passed — don't schedule in the past

    const child = childById(entry.childId);
    fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'זמן למנה הבאה 💊',
        message: `אפשר לתת ל${child ? child.name : 'הילד/ה'} מנה נוספת של ${entry.medicine}`,
        childName: child ? child.name : undefined,
        scheduledTime: new Date(readyAt).toISOString(),
        externalId: entry.id,
      }),
    }).catch(() => {}); // best-effort — never block the UI on a failed schedule call
  }

  function saveMed() {
    if (!medChildSel) { toast('אין ילד לבחור — הוסיפו ילד/ה קודם'); return; }
    const patch = {
      childId: medChildSel,
      medicine: medMedicineSel || 'תרופה',
      dose: document.getElementById('med-dose').value.trim(),
      note: document.getElementById('med-note').value.trim(),
      time: timeToToday(document.getElementById('med-time').value || nowHHMM()),
    };
    if (editMedEntryId) {
      DB.updateMedEntry(editMedEntryId, patch);
      toast('התרופה עודכנה ✓');
    } else {
      const entry = DB.addMedEntry(patch);
      let customReadyAt = null;
      if (doseReminderMode === 'custom') {
        const val = document.getElementById('med-reminder-custom').value;
        if (val) customReadyAt = new Date(val).getTime(); // parsed as local time, as entered
      }
      scheduleDoseReminder(entry, customReadyAt); // falls back to automatic interval if no custom time was set
      toast('התרופה נשמרה ✓');
    }
    editMedEntryId = null;
    closeSheet('sheet-med');
    renderDashboard();
    renderHistory();
  }
  function deleteMedEntry() {
    if (!editMedEntryId) return;
    if (!confirm('למחוק את הרשומה הזו? הפעולה אינה הפיכה.')) return;
    DB.deleteMedEntry(editMedEntryId);
    editMedEntryId = null;
    closeSheet('sheet-med');
    toast('הרשומה נמחקה');
    renderDashboard();
    renderHistory();
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
      const openFn = e.kind === 'med' ? `App.openMedSheet('${e.id}')` : `App.openTempSheet('${e.id}')`;
      html += `<div class="hist-row" onclick="${openFn}">
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
      `<div class="temp-row" onclick="App.openTempSheet('${r.id}')"><span>${formatClock(r.time)}</span><span class="v">${r.value}°</span></div>`).join('') ||
      `<div class="empty-state"><div class="ic">🌡️</div><div class="t">אין מדידות</div><div class="s">לחצו על "הוספת מדידה" כדי להתחיל</div></div>`;
  }
  function setTempFilter(id) { tempChildSel = id; renderTemp(); }

  function openTempSheet(entryId) {
    const state = DB.get();
    editTempEntryId = entryId || null;
    const entry = entryId ? state.tempEntries.find((e) => e.id === entryId) : null;
    if (entry) tempChildSel = entry.childId;
    else if (!tempChildSel && state.children.length) tempChildSel = state.children[0].id;
    document.getElementById('temp-child-chips').innerHTML = state.children.map((c) =>
      `<button type="button" class="chip ${c.id === tempChildSel ? 'sel' : ''}" data-id="${c.id}" onclick="App.pickTempChild('${c.id}')">${c.emoji} ${c.name}</button>`).join('');
    document.getElementById('temp-value').value = entry ? entry.value : '';
    document.getElementById('temp-error').style.display = 'none';
    document.getElementById('temp-time').value = entry ? formatClock(entry.time) : nowHHMM();
    document.getElementById('temp-sheet-title').textContent = entry ? 'עריכת מדידת חום' : 'הוספת מדידת חום';
    document.getElementById('temp-delete-btn').style.display = entry ? '' : 'none';
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
    const patch = { childId: tempChildSel, value: val, time: timeToToday(document.getElementById('temp-time').value || nowHHMM()) };
    if (editTempEntryId) {
      DB.updateTempEntry(editTempEntryId, patch);
      toast('המדידה עודכנה ✓');
    } else {
      DB.addTempEntry(patch);
      toast('המדידה נשמרה ✓');
    }
    editTempEntryId = null;
    closeSheet('sheet-temp');
    renderTemp();
    renderDashboard();
    renderHistory();
  }
  function deleteTempEntry() {
    if (!editTempEntryId) return;
    if (!confirm('למחוק את המדידה הזו? הפעולה אינה הפיכה.')) return;
    DB.deleteTempEntry(editTempEntryId);
    editTempEntryId = null;
    closeSheet('sheet-temp');
    toast('הרשומה נמחקה');
    renderTemp();
    renderDashboard();
    renderHistory();
  }

  /* ---------- hero card interactions ---------- */
  function heroClick() {
    if (heroState.type === 'med') { openMedSheet(); return; }
    if (heroState.type === 'weight' && heroState.childId) { openEditKid(heroState.childId); return; }
    // 'fever' and 'calm' states are informational only — no action on tap
  }

  /* picks the child most in need of a weight update (single child → that child;
     multiple → oldest weightUpdatedAt, or first child if none ever set) and opens the edit sheet directly */
  function quickWeightUpdate() {
    const state = DB.get();
    if (!state.children.length) { toast('הוסיפו ילד/ה קודם דרך הגדרות'); return; }
    if (state.children.length === 1) { openEditKid(state.children[0].id); return; }
    const target = [...state.children].sort((a, b) => (a.weightUpdatedAt || 0) - (b.weightUpdatedAt || 0))[0];
    openEditKid(target.id);
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


  /* ---------- dose calculator ---------- */
  const DOSE_DB = {
    'נובימול': {
      interval: '4–6 שעות',
      intervalHours: 4,
      maxDosesPerDay: 5,
      matchNames: ['נובימול'],
      concentrations: [
        {
          label: 'טיפות 100 מ"ג/מ"ל (טיפטיפות)',
          mgPerMl: 100,
          // exact table from the official patient leaflet — no formula, no rounding
          doseTable: [
            { kg: 3,  mg: 45,  ml: 0.45 },
            { kg: 4,  mg: 60,  ml: 0.60 },
            { kg: 5,  mg: 75,  ml: 0.75 },
            { kg: 6,  mg: 90,  ml: 0.90 },
            { kg: 7,  mg: 105, ml: 1.05 },
            { kg: 8,  mg: 120, ml: 1.20 },
            { kg: 9,  mg: 135, ml: 1.35 },
            { kg: 10, mg: 150, ml: 1.50 },
            { kg: 11, mg: 165, ml: 1.65 },
            { kg: 12, mg: 180, ml: 1.80 },
            { kg: 13, mg: 195, ml: 1.95 },
            { kg: 14, mg: 210, ml: 2.10 },
            { kg: 15, mg: 225, ml: 2.25 },
            { kg: 16, mg: 240, ml: 2.40 },
            { kg: 17, mg: 255, ml: 2.55 },
            { kg: 18, mg: 270, ml: 2.70 },
            { kg: 19, mg: 285, ml: 2.85 },
            { kg: 20, mg: 300, ml: 3.00 },
            { kg: 21, mg: 315, ml: 3.15 },
            { kg: 22, mg: 330, ml: 3.30 },
            { kg: 23, mg: 345, ml: 3.45 },
            { kg: 24, mg: 360, ml: 3.60 },
            { kg: 25, mg: 375, ml: 3.75 },
            { kg: 26, mg: 390, ml: 3.90 },
            { kg: 27, mg: 405, ml: 4.05 },
            { kg: 28, mg: 420, ml: 4.20 },
            { kg: 29, mg: 435, ml: 4.35 },
            { kg: 30, mg: 450, ml: 4.50 },
          ],
        },
      ]
    },
    'אקמול': {
      interval: null,
      intervalHours: null,
      maxDosesPerDay: null,
      matchNames: ['אקמול'],
      concentrations: [
        { label: 'ממתין לעלון רשמי', pendingLeaflet: true },
      ]
    },
    'נורופן': {
      interval: '6–8 שעות (מרווח מינימלי 4 שעות)',
      intervalHours: 4,
      maxDosesPerDay: 4,
      matchNames: ['נורופן', 'איבופרופן', 'אדוויל'],
      concentrations: [
        {
          label: 'סירופ 100 מ"ג/5מ"ל (20 מ"ג/מ"ל)',
          mgPerMl: 20,
          // exact table from the official patient leaflet — no formula, no rounding
          doseTable: [
            { kgMin: 5,  kgMax: 5.4,  ml: 2 },
            { kgMin: 5.5, kgMax: 8.1, ml: 2.5 },
            { kgMin: 8.2, kgMax: 10.9, ml: 3.75 },
            { kgMin: 11, kgMax: 15,  ml: 5 },
            { kgMin: 16, kgMax: 21,  ml: 7.5 },
            { kgMin: 22, kgMax: 26,  ml: 10 },
            { kgMin: 27, kgMax: 32,  ml: 12.5 },
            { kgMin: 33, kgMax: 43,  ml: 15 },
          ],
        },
        { label: 'פורטה 200 מ"ג/5מ"ל', pendingLeaflet: true },
      ]
    },
  };

  let doseMedSel = 'אקמול / נובימול';
  let doseConcIdx = 0;
  let doseChildId = null;

  function openDoseSheet() {
    const state = DB.get();
    doseChildId = state.children[0]?.id || null;
    doseMedSel = 'נובימול';
    doseConcIdx = 0;
    _renderDoseChildChips();
    _renderDoseMedChips();
    _renderDoseConcChips();
    document.getElementById('dose-weight').value = ''; // always empty — must be typed fresh every time
    calcDose();
    openSheet('sheet-dose');
  }

  function _renderDoseChildChips() {
    const state = DB.get();
    const box = document.getElementById('dose-child-chips');
    if (!box) return;
    box.innerHTML = state.children.map((c) =>
      `<button type="button" class="chip ${c.id === doseChildId ? 'sel' : ''}" onclick="App.pickDoseChild('${c.id}')">${c.emoji} ${c.name}</button>`
    ).join('');
  }

  function pickDoseChild(id) {
    doseChildId = id;
    _renderDoseChildChips();
    calcDose(); // weight value itself is untouched — only history warnings re-check for the new child
  }

  function _renderDoseMedChips() {
    document.getElementById('dose-med-chips').innerHTML = Object.keys(DOSE_DB).map((m) =>
      `<button type="button" class="chip ${m === doseMedSel ? 'sel' : ''}" onclick="App.pickDoseMed('${m}')">${m}</button>`
    ).join('');
  }

  function _renderDoseConcChips() {
    const concs = DOSE_DB[doseMedSel].concentrations;
    document.getElementById('dose-conc-chips').innerHTML = concs.map((c, i) =>
      `<button type="button" class="chip ${i === doseConcIdx ? 'sel' : ''}" onclick="App.pickDoseConc(${i})">${c.label}</button>`
    ).join('');
  }

  function pickDoseMed(name) {
    doseMedSel = name;
    doseConcIdx = 0;
    _renderDoseMedChips();
    _renderDoseConcChips();
    calcDose();
  }

  function pickDoseConc(idx) {
    doseConcIdx = idx;
    _renderDoseConcChips();
    calcDose();
  }

  /* does a free-text medicine name (as stored in medEntries) belong to this DOSE_DB drug? */
  function _matchesDrug(medicineName, drugKey) {
    if (!medicineName) return false;
    const names = DOSE_DB[drugKey].matchNames || [];
    return names.some((n) => medicineName.indexOf(n) !== -1);
  }

  function _doseHistoryWarning(drugKey) {
    if (!doseChildId) return null;
    const drug = DOSE_DB[drugKey];
    const now = Date.now();
    const entries = DB.get().medEntries.filter((e) => e.childId === doseChildId && _matchesDrug(e.medicine, drugKey));
    if (!entries.length) return null;

    const last = entries.reduce((a, b) => (b.time > a.time ? b : a));

    if (drug.intervalHours != null) {
      const hoursSince = (now - last.time) / 3600000;
      if (hoursSince < drug.intervalHours) {
        const remain = Math.ceil(drug.intervalHours - hoursSince);
        return { level: 'alert', text: `⏱️ המנה האחרונה הייתה לפני ${hoursSince < 1 ? 'פחות משעה' : Math.floor(hoursSince) + ' שעות'} — המרווח המומלץ הוא ${drug.interval}. מומלץ להמתין כ־${remain} שעות נוספות לפני מנה נוספת.` };
      }
    }

    if (drug.maxDosesPerDay != null) {
      const last24h = entries.filter((e) => now - e.time <= 24 * 3600000).length;
      if (last24h >= drug.maxDosesPerDay) {
        return { level: 'alert', text: `⚠️ כבר ניתנו ${last24h} מנות מהתרופה הזו ב־24 השעות האחרונות — זהו המספר המרבי המומלץ ליום. אין לתת מנה נוספת בלי להתייעץ עם רופא/ה או רוקח/ת.` };
      }
    }
    return null;
  }

  /* find the leaflet table row for a given weight — never extrapolates beyond the table.
     Supports two official leaflet formats:
     - per-kg rows ({kg, ml, mg}) — floors to the nearest defined weight (e.g. Novimol)
     - weight-range rows ({kgMin, kgMax, ml}) — exact bracket match (e.g. Nurofen) */
  function _findDoseRow(doseTable, weight) {
    const isRangeTable = doseTable[0].kgMin != null;

    if (isRangeTable) {
      const sorted = [...doseTable].sort((a, b) => a.kgMin - b.kgMin);
      if (weight < sorted[0].kgMin) return { outOfRange: 'below', min: sorted[0].kgMin, max: sorted[sorted.length - 1].kgMax };
      if (weight > sorted[sorted.length - 1].kgMax) return { outOfRange: 'above', min: sorted[0].kgMin, max: sorted[sorted.length - 1].kgMax };
      const row = sorted.find((r) => weight >= r.kgMin && weight <= r.kgMax);
      if (!row) return { outOfRange: 'below', min: sorted[0].kgMin, max: sorted[sorted.length - 1].kgMax }; // falls in a gap between brackets
      return { row };
    }

    const sorted = [...doseTable].sort((a, b) => a.kg - b.kg);
    if (weight < sorted[0].kg) return { outOfRange: 'below', min: sorted[0].kg, max: sorted[sorted.length - 1].kg };
    if (weight > sorted[sorted.length - 1].kg) return { outOfRange: 'above', min: sorted[0].kg, max: sorted[sorted.length - 1].kg };
    // exact match if present, otherwise the nearest lower defined weight
    let row = sorted[0];
    for (const r of sorted) { if (r.kg <= weight) row = r; else break; }
    return { row };
  }

  function calcDose() {
    const weight = parseFloat(document.getElementById('dose-weight').value);
    const box = document.getElementById('dose-result');
    const warnBox = document.getElementById('dose-warning');
    if (warnBox) { warnBox.style.display = 'none'; warnBox.innerHTML = ''; }

    if (!weight || weight < 1 || weight > 60) { box.style.display = 'none'; return; }

    const drug = DOSE_DB[doseMedSel];
    const conc = drug.concentrations[doseConcIdx];

    if (conc.pendingLeaflet) {
      box.style.display = 'none';
      if (warnBox) {
        warnBox.style.display = 'block';
        warnBox.className = 'dose-warning dose-warning-block';
        warnBox.innerHTML = `📋 עדיין אין טבלת מינון רשמית לצורת מתן זו במערכת. יש לצלם את עלון היצרן ולשלוח כדי שהמינון המדויק יתווסף — עד אז אין הצגת מינון עבורה.`;
      }
      return;
    }

    const lookup = _findDoseRow(conc.doseTable, weight);
    if (lookup.outOfRange) {
      box.style.display = 'none';
      if (warnBox) {
        warnBox.style.display = 'block';
        warnBox.className = 'dose-warning dose-warning-block';
        const dir = lookup.outOfRange === 'below' ? 'מתחת' : 'מעל';
        warnBox.innerHTML = `🚫 המשקל ${dir} לטווח הטבלה הרשמית של צורת מתן זו (${lookup.min}–${lookup.max} ק"ג). יש לבחור צורת מתן אחרת המתאימה למשקל, או להתייעץ עם רופא/ה או רוקח/ת.`;
      }
      return;
    }

    const { row } = lookup;
    const mg = row.mg != null ? row.mg : (conc.mgPerMl != null ? Math.round(row.ml * conc.mgPerMl) : null);
    const weightLabel = row.kg != null ? `${row.kg} ק"ג` : `${row.kgMin}–${row.kgMax} ק"ג`;
    const subParts = [];
    if (drug.interval) subParts.push(`כל ${drug.interval}`);
    if (drug.maxDosesPerDay != null) subParts.push(`עד ${drug.maxDosesPerDay} מנות ב-24 שעות`);
    box.style.display = 'block';
    box.innerHTML = `
      <div class="dose-result-title">המינון לפי טבלת היצרן</div>
      <div class="dose-result-ml">${row.ml.toFixed(2)} מ"ל</div>
      <div class="dose-result-sub">${subParts.length ? subParts.join(' · ') : 'יש לבדוק מרווח ומספר מנות מרבי בעלון'}</div>
      <div class="dose-result-detail">${mg != null ? mg + ' מ"ג ' : ''}לילד/ה במשקל ${weightLabel} (טבלת עלון היצרן)</div>
    `;

    const warning = _doseHistoryWarning(doseMedSel);
    if (warning && warnBox) {
      warnBox.style.display = 'block';
      warnBox.className = 'dose-warning dose-warning-' + warning.level;
      warnBox.innerHTML = warning.text;
    }
  }

  /* ---------- settings ---------- */
  function renderSettings() {
    const on = DB.get().settings.notifications;
    document.getElementById('toggle-notif').classList.toggle('on', on);
    document.getElementById('set-version-num').textContent = APP_VERSION;
  }
  function toggleNotif() {
    const on = !DB.get().settings.notifications;

    // עדכן UI מיד — לפני כל async
    DB.setSetting('notifications', on);
    renderSettings();

    window.OneSignalDeferred = window.OneSignalDeferred || [];
    OneSignalDeferred.push(async function(OneSignal) {
      if (on) {
        const permState = Notification.permission;

        if (permState === 'denied') {
          // iOS חסם — החזר טאגל לכבוי
          DB.setSetting('notifications', false);
          renderSettings();
          toast('אפשר גישה להתראות: הגדרות ← Medickids ← התראות');
          return;
        }

        if (permState === 'granted') {
          await OneSignal.User.PushSubscription.optIn();
          toast('התראות הופעלו ✅');
          return;
        }

        // default — בקש רשות
        const granted = await OneSignal.Notifications.requestPermission();
        if (granted) {
          await OneSignal.User.PushSubscription.optIn();
          toast('התראות הופעלו ✅');
        } else {
          DB.setSetting('notifications', false);
          renderSettings();
          toast('אפשר גישה להתראות: הגדרות ← Medickids ← התראות');
        }
      } else {
        await OneSignal.User.PushSubscription.optOut();
        toast('התראות כובו');
      }
    });
  }

  /* ---------- version / updates ---------- */
  function checkForUpdate() {
    if (!('serviceWorker' in navigator)) { toast('הדפדפן לא תומך בבדיקת עדכונים'); return; }
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg) { toast('לא נמצא Service Worker פעיל'); return; }
      toast('בודק עדכונים…');
      let updated = false;
      const onControllerChange = () => {
        updated = true;
        toast('נמצא עדכון — טוען מחדש…');
        setTimeout(() => window.location.reload(), 600);
      };
      navigator.serviceWorker.addEventListener('controllerchange', onControllerChange, { once: true });
      reg.update().catch(() => {});
      setTimeout(() => {
        if (!updated) {
          navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
          toast(`אתה כבר בגרסה העדכנית (${APP_VERSION}) ✓`);
        }
      }, 2500);
    });
  }

  /* ---------- danger zone ---------- */
  function confirmReset() {
    const sure = confirm('לאפס את כל הנתונים? כל הילדים, התרופות והמדידות יימחקו לצמיתות. הפעולה אינה הפיכה.');
    if (!sure) return;
    const reallySure = confirm('בטוח/ה לגמרי? זו הזדמנות אחרונה לבטל.');
    if (!reallySure) return;
    DB.reset();
    toast('כל הנתונים אופסו');
    renderLanding();
    renderDashboard();
    renderHistory();
    renderTemp();
    renderSettings();
    renderKids();
    goto('screen-kids');
  }

  /* ---------- clock ---------- */
  function tickClock() {
    const el = document.getElementById('clock');
    if (el) el.textContent = nowHHMM();
  }

  function init() {
    // Render all screens so they're ready before any transition
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

    // ---------- flow routing ----------
    // Step 1: non-standalone browser → show Landing (A2HS prompt), stop here.
    if (!isStandalone()) {
      goto('screen-landing');
      return;
    }

    // Step 2: standalone (installed PWA) — decide by data, not by platform.
    const isReturningUser = DB.get().children.length > 0;

    if (isReturningUser) {
      // Returning user: short splash → Dashboard
      showSplash();
      setTimeout(() => goto('screen-dash'), SPLASH_DURATION_RETURNING);
    } else {
      // New user: splash → Onboarding (add first child) → Dashboard
      showSplash();
      setTimeout(() => goto('screen-kids'), SPLASH_DURATION_NEW);
    }
  }

  return {
    goto, tab, openSheet, closeSheet,
    openMedSheet, pickMedChild, pickMedMedicine, addCustomMedicine, saveMed, pickReminderMode,
    setHistFilter, setTempFilter, openTempSheet, pickTempChild, saveTemp,
    openEditKid, saveKid, toggleNotif, init,
    installNow, skipLanding,
    openDoseSheet, pickDoseChild, pickDoseMed, pickDoseConc, calcDose,
    heroClick, quickWeightUpdate,
    deleteMedEntry, deleteTempEntry, confirmReset,
    checkForUpdate,
  };
})();

document.addEventListener('DOMContentLoaded', App.init);







