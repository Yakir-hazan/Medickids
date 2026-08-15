const App = (() => {
  /* ---------- flow constants ---------- */
  /* ⚠️ CLAUDE: bump APP_VERSION on EVERY push to this repo — and bump the -vNN suffix of
     CACHE_NAME in sw.js at the same time (they don't need matching text, just both incremented
     together). This value is shown to the user in Settings and is what "בדוק אם יש עדכון"
     relies on to prove a new version actually loaded. Forgetting to bump it breaks both.
     Beta scheme: 1.0.0-beta.49 → 1.0.0-beta.47 → ... → 1.0.0 once out of beta. */
  const APP_VERSION = '1.0.0-beta.102';
  const SPLASH_DURATION_RETURNING = 1500; // ms — short splash for returning users
  const SPLASH_DURATION_NEW       = 2200; // ms — slightly longer for new users

  const AVATAR_GRADIENT = {
    a1: 'linear-gradient(135deg,#FFB6A3,#FF9F6B)',
    a2: 'linear-gradient(135deg,#D64545,#E06060)',
  };

  let medChildSel = null;
  let medMedicineSel = null;
  let tempChildSel = null;
  let histFilter = 'all';
  let editMedEntryId = null;
  let doseReminderMode = 'auto'; // 'auto' | 'custom' — reminder timing for PRN doses being logged
  let dailyReminderOn = true; // for DAILY-protocol medicines — whether to keep a recurring reminder
  let editTempEntryId = null;
  let editingKidId = null; // null = add mode
  let selectedChildId = null; // שלב 3 — selected child panel
  let deferredInstallPrompt = null;

  /* ── onboarding state ── */
  let _obParent  = 'dad';   // 'dad' | 'mom'
  let _obAvatar  = '🧒';
  let _obPhoto   = null;    // base64 data URL or null

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
    if (isStandalone()) { return; } // Auth routing handles navigation — no splash here
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

  /* Returns age in whole months from a YYYY-MM-DD birthDate string, or null if unknown. */
  function calcAgeMonths(birthDate) {
    if (!birthDate) return null;
    const born = new Date(birthDate);
    const now  = new Date();
    return (now.getFullYear() - born.getFullYear()) * 12 + (now.getMonth() - born.getMonth());
  }

  /* Returns the next timestamp (ms) for a fixed HH:MM time.
     If the time hasn't passed today → use today; otherwise → tomorrow. */
  function _nextFixedTime(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    const t = new Date();
    t.setHours(h, m, 0, 0);
    if (t.getTime() <= Date.now()) t.setDate(t.getDate() + 1);
    return t.getTime();
  }

  /* ---------- navigation ---------- */
  function goto(id) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
      document.getElementById(id).classList.add('active');
      if (id === 'screen-kids') renderKids();
      return;
    }
    const next = document.getElementById(id);
    const curr = document.querySelector('.screen.active');
    if (curr && curr !== next) {
      curr.style.transition = 'opacity 180ms ease';
      curr.style.opacity = '0';
      setTimeout(() => { curr.classList.remove('active'); curr.style.opacity = ''; curr.style.transition = ''; }, 185);
    }
    next.style.transition = 'none';
    next.style.opacity = '0';
    next.style.transform = 'translateY(14px)';
    next.classList.add('active');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      next.style.transition = 'opacity 200ms ease, transform 220ms ease';
      next.style.opacity = '';
      next.style.transform = '';
    }));
    if (id === 'screen-kids') renderKids();
  }
  function showSplash() {
    goto('screen-splash');
    animateSplashThermo();
    // בקש רשות התראות OneSignal — רק ב-PWA מותקן (standalone)
    if (isStandalone()) {
      window.OneSignalDeferred = window.OneSignalDeferred || [];
      OneSignalDeferred.push(async function(OneSignal) {
        // מזהה את ההתקנה הזו אצל OneSignal לפי deviceId יציב, כדי שתזכורות ישלחו רק
        // למכשיר הזה (include_aliases/external_id בשרת) ולא לכל המנויים. רץ בכל פתיחה
        // standalone כדי לכסות גם התקנות ותיקות (migration אוטומטי, בלי קוד נפרד).
        await OneSignal.login(DB.get().deviceId);
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
    const el = document.getElementById(id);
    const sheet = el.querySelector('.sheet');
    if (sheet) {
      sheet.style.transition = 'transform 260ms cubic-bezier(0.32,0.72,0,1)';
      sheet.style.transform = 'translateY(100%)';
    }
    el.style.transition = 'opacity 260ms ease';
    el.style.opacity = '0';
    setTimeout(() => {
      el.classList.remove('open');
      el.style.opacity = '';
      el.style.transition = '';
      if (sheet) { sheet.style.transform = ''; sheet.style.transition = ''; }
    }, 270);
    if (id === 'sheet-med') editMedEntryId = null;
    if (id === 'sheet-temp') editTempEntryId = null;
  }

  /* ── UX Motion: button press feedback (Scale + Opacity) ── */
  document.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('button:not([disabled])');
    if (!btn) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    btn.style.transition = 'transform 80ms ease, opacity 80ms ease';
    btn.style.transform = 'scale(0.93)';
    btn.style.opacity = '0.65';
    const reset = () => {
      btn.style.transition = 'transform 160ms ease, opacity 160ms ease';
      btn.style.transform = '';
      btn.style.opacity = '';
      btn.removeEventListener('pointerup', reset);
      btn.removeEventListener('pointercancel', reset);
    };
    btn.addEventListener('pointerup', reset);
    btn.addEventListener('pointercancel', reset);
  }, { passive: true });

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

    // 2) dose timing — reuses the same MEDICATION_CATALOG intervals as the dose calculator, so the two never contradict each other
    const lastMed = DB.lastMedFor(c.id);
    if (lastMed) {
      const drugKey = Object.keys(MEDICATION_CATALOG).find((k) => _matchesDrug(lastMed.medicine, k));
      const drug = drugKey ? MEDICATION_CATALOG[drugKey] : null;
      if (drug && drug.protocol.intervalHours != null) {
        const hoursSince = (now - lastMed.time) / 3600000;
        const remain = drug.protocol.intervalHours - hoursSince;
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

  /* Auto-create supplement prescriptions for children in the eligible age range.
     Runs once on every renderDashboard — idempotent (won't duplicate). */
  function _ensureSupplementPrescriptions() {
    // מיגרציה: מסמן entries ישנים של supplements שנשמרו ללא isSupp:true
    const SUPP_NAMES = ['ויטמין D', 'ברזל'];
    const db = DB.get();
    let migrated = false;
    db.medEntries.forEach(e => {
      if (SUPP_NAMES.includes(e.medicine) && !e.isSupp) {
        e.isSupp = true;
        migrated = true;
      }
    });
    if (migrated) { try { localStorage.setItem('madhom_v1', JSON.stringify(db)); } catch(e) {} }

    const state = DB.get();
    const SUPP_IDS = ['vitamin_d_drops', 'iron_drops'];
    const SUPPLEMENTS = [
      { productId: 'vitamin_d_drops', maxMonths: 12 },
      { productId: 'iron_drops',      maxMonths: 18 },
    ];

    // מיגרציה: prescriptions קיימות עם reminder.on=false → הפוך ל-true
    state.prescriptions
      .filter(p => SUPP_IDS.includes(p.productId) && p.status === 'active' && p.reminder && !p.reminder.on)
      .forEach(p => {
        console.log('[Supp] migration: enabling reminder.on for', p.productId);
        DB.updatePrescription(p.id, { reminder: { on: true, time: p.reminder.time || '08:00' } });
      });

    state.children.forEach((c) => {
      const ageMonths = calcAgeMonths(c.birthDate);
      SUPPLEMENTS.forEach(({ productId, maxMonths }) => {
        const inRange = ageMonths === null || ageMonths < maxMonths;
        if (!inRange) return;
        const exists = state.prescriptions.find(
          (p) => p.childId === c.id && p.productId === productId && p.status === 'active'
        );
        if (!exists) {
          DB.addPrescription({
            childId: c.id,
            productId,
            protocolType: 'daily',
            isCourse: false,
            reminder: { on: true, time: '08:00' }, // on by default
          });
        }
      });
    });
  }

  function renderDashboard() {
    _ensureSupplementPrescriptions();
    // migration: הוסף createdAt לילדים — אם יש להם createdAt שנראה כמו birthDate, אפס להיום
    const _nowMs = Date.now();
    DB.get().children.forEach(c => {
      // אם אין createdAt, או אם createdAt זהה לתאריך לידה (migration ישן) — קבע להיום
      const birthTs = c.birthDate ? new Date(c.birthDate).getTime() : 0;
      if (!c.createdAt || c.createdAt === birthTs) {
        DB.updateChild(c.id, { createdAt: _nowMs });
      }
    });
    const state = DB.get();
    const now = Date.now();

    // ---------- header ----------
    const hour = new Date().getHours();
    const timeGreet = hour < 5 ? 'לילה טוב' : hour < 12 ? 'בוקר טוב' : hour < 17 ? 'צהריים טובים' : hour < 21 ? 'ערב טוב' : 'לילה טוב';
    const famName = state.family ? `משפחת ${state.family}` : '';
    // mockup layout: small greeting line = "שלום, X 👋", big line = time greeting
    document.getElementById('dash-greeting').textContent = famName ? `שלום, ${famName} 👋` : 'שלום 👋';
    // Only override dash-title with time greeting if not overridden later by empty-state / fever logic
    document.getElementById('dash-title').dataset.timeGreet = timeGreet;
    // date pill
    const _dp = document.getElementById('dash-date-text');
    if (_dp) {
      const _d = new Date();
      const _days = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
      const _months = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
      _dp.textContent = `${_days[_d.getDay()]}, ${_d.getDate()} ${_months[_d.getMonth()]} ${_d.getFullYear()}`;
    }

    // ---------- empty state ----------
    const wrap = document.getElementById('dash-children');
    if (!state.children.length) {
      wrap.innerHTML = `<div class="empty-state"><div class="ic">👨‍👩‍👧‍👦</div><div class="t">עדיין אין ילדים באפליקציה</div><div class="s">הוסיפו ילד/ה דרך הגדרות ← ניהול ילדים</div></div>`;
      document.getElementById('dash-title').textContent = 'ברוכים הבאים ל-Medickids';
      document.getElementById('dash-updated').style.display = 'none';
      document.getElementById('dash-hero').style.display = 'none';
      document.getElementById('dash-fam-summary').style.display = 'none';
      // dash-active-treatments removed from dashboard
      document.getElementById('dash-timeline').style.display = 'none';
      document.getElementById('dash-insight').style.display = 'none';
      document.getElementById('dash-urgent').style.display = 'none';
      if (document.getElementById('dash-fever-tracker')) document.getElementById('dash-fever-tracker').style.display = 'none';
      if (document.getElementById('dash-tip-card')) document.getElementById('dash-tip-card').style.display = 'none';
      return;
    }
    document.getElementById('dash-hero').style.display = 'none'; // v2: hero hidden

    // ---------- compute per-child data ----------
    const childData = state.children.map((c) => {
      const lastMed = DB.lastMedFor(c.id);
      const lastTemp = DB.lastTempFor(c.id);
      const hasFever = lastTemp && lastTemp.value >= 38;

      // next dose countdown
      let nextDoseMs = null;
      let nextDrugName = null;
      if (lastMed) {
        const drugKey = Object.keys(MEDICATION_CATALOG).find((k) => _matchesDrug(lastMed.medicine, k));
        const drug = drugKey ? MEDICATION_CATALOG[drugKey] : null;
        if (drug && drug.protocol.intervalHours) {
          const readyAt = lastMed.time + drug.protocol.intervalHours * 3600000;
          if (readyAt > now) { nextDoseMs = readyAt - now; nextDrugName = lastMed.medicine; }
        }
      }

      // mood
      let mood = '😊';
      if (hasFever && lastTemp.value >= 39) mood = '😓';
      else if (hasFever) mood = '🤒';

      // active course prescriptions for this child
      const activeCourses = state.prescriptions.filter(
        (p) => p.childId === c.id && p.isCourse && p.status === 'active'
      );

      return { c, lastMed, lastTemp, hasFever, nextDoseMs, nextDrugName, mood, activeCourses };
    });

    // ---------- title ----------
    const anyFever = childData.some((d) => d.hasFever);
    const anyActive = childData.some((d) => d.activeCourses.length > 0);
    const allCalm = !anyFever && !anyActive;
    const _tg = document.getElementById('dash-title').dataset.timeGreet || timeGreet;
    document.getElementById('dash-title').textContent = _tg;

    // ---------- header color — ירוק כשכולם בריאים ----------
    const dashHeader = document.querySelector('.dash-header-new');
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    // צבע דינמי — ירוק=בריא / אדום=חום|טיפול
    const THEME_CALM  = { main: '#059669', light: '#10b981', tint: 'rgba(5,150,105,0.10)',   dark: '#047857' };
    const THEME_ALERT = { main: '#D64545', light: '#E06060', tint: 'rgba(214,69,69,0.10)',   dark: '#B03535' };
    const theme = allCalm ? THEME_CALM : THEME_ALERT;

    // עדכן CSS variables גלובלי — כל האלמנטים שמשתמשים ב-var(--purple)/var(--gold) יתעדכנו
    const root = document.documentElement;
    root.style.setProperty('--purple',      theme.main);
    root.style.setProperty('--purple-2',    theme.light);
    root.style.setProperty('--purple-tint', theme.tint);
    root.style.setProperty('--gold',        theme.main);
    root.style.setProperty('--gold-deep',   theme.dark);
    root.style.setProperty('--tint',        theme.tint);
    root.style.setProperty('--lav',         theme.light);
    root.style.setProperty('--lav-soft',    theme.tint);

    if (allCalm) {
      dashHeader.style.background = 'linear-gradient(150deg, #059669 0%, #10b981 100%)';
      if (themeColorMeta) themeColorMeta.setAttribute('content', '#059669');
      // calm sub-message
      let calmMsg = document.getElementById('dash-calm-msg');
      if (!calmMsg) {
        calmMsg = document.createElement('div');
        calmMsg.id = 'dash-calm-msg';
        calmMsg.style.cssText = 'margin-top:10px;font-size:13px;font-weight:700;color:rgba(255,255,255,0.95);position:relative;';
        dashHeader.appendChild(calmMsg);
      }
      calmMsg.textContent = '🌟 הכל תקין במשפחה';
      calmMsg.style.display = '';
    } else {
      dashHeader.style.background = 'linear-gradient(150deg, #D64545 0%, #E06060 100%)';
      if (themeColorMeta) themeColorMeta.setAttribute('content', '#D64545');
      const calmMsg = document.getElementById('dash-calm-msg');
      if (calmMsg) calmMsg.style.display = 'none';
    }

    // ---------- header: last updated ----------
    const latestEvent = DB.feed(null)[0] || null;
    document.getElementById('dash-updated').style.display = 'none'; // v2: hidden

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
      famSummary.style.display = 'none'; // v2: fam-summary hidden
    } else {
      famSummary.style.display = 'none';
    }

    // ---------- urgent card (v2 mockup) ----------
    const urgentEl = document.getElementById('dash-urgent');
    // find child with overdue dose (nextDoseMs === 0 means ready, negative means overdue)
    const overdueDose = childData
      .filter((d) => d.lastMed && d.nextDoseMs !== null && d.nextDoseMs <= 0)
      .sort((a, b) => a.nextDoseMs - b.nextDoseMs)[0] || null;

    // also show if next dose is ready now (within 15 min past due)
    const readyNow = childData
      .filter((d) => d.lastMed && d.nextDoseMs !== null && d.nextDoseMs <= 15 * 60 * 1000)
      .sort((a, b) => a.nextDoseMs - b.nextDoseMs)[0] || null;

    const urgentTarget = overdueDose || readyNow;
    if (urgentTarget) {
      const { c, lastMed, nextDoseMs } = urgentTarget;
      // supplement daily reminders — active prescriptions for this child
    let supplementRow = '';
    {
      const suppIds = ['vitamin_d_drops', 'iron_drops'];
      const suppLabels = { vitamin_d_drops: { emoji: '☀️', name: 'ויטמין D' }, iron_drops: { emoji: '🩸', name: 'ברזל' } };
      const activeSupps = DB.get().prescriptions.filter(
        (p) => p.childId === c.id && suppIds.includes(p.productId) && p.status === 'active'
      );
      if (activeSupps.length) {
        const rows = activeSupps.map((rx) => {
          const lbl = suppLabels[rx.productId] || { emoji: '💊', name: rx.productId };
          const lastGiven = DB.get().medEntries
            .filter((e) => e.childId === c.id && e.medicine === lbl.name)
            .sort((a, b) => b.time - a.time)[0] || null;
          const lastStr = lastGiven
            ? `ניתן ${elapsedString(lastGiven.time)} לפני`
            : 'עדיין לא ניתן היום';
          return `<div class="scp-row scp-row-normal" style="flex-wrap:wrap;gap:6px;">
            <span class="scp-row-ic">${lbl.emoji}</span>
            <span class="scp-row-lbl">${lbl.name} · ${lastStr}</span>
            <button onclick="App.markSupplementGiven('${rx.id}')" style="margin-top:4px;width:100%;padding:7px;border-radius:10px;border:none;background:var(--mint,#10b981);color:#fff;font-size:13px;font-weight:600;cursor:pointer;">✓ ניתן עכשיו</button>
          </div>`;
        }).join('');
        supplementRow = `<div style="padding:4px 0;">
          <div style="font-size:12px;font-weight:700;color:var(--ink-soft);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px;">תוספים יומיים</div>
          ${rows}
        </div>`;
      }
    }

    const avatarColors = ['avatar-pink','avatar-blue','avatar-green','avatar-pink','avatar-blue'];
      const avatarClass = avatarColors[c.color % avatarColors.length] || 'avatar-blue';
      const minsLate = Math.abs(Math.round((nextDoseMs || 0) / 60000));
      const subText = nextDoseMs <= 0
        ? `מינון — לפני ${minsLate} דקות`
        : 'המינון הבא מוכן';
      urgentEl.innerHTML = `
        <div class="urgent-label">
          <div class="pulse-dot"></div>
          <span class="urgent-label-text">פעולה דחופה</span>
        </div>
        <div class="urgent-row">
          <div class="avatar-lg ${avatarClass}">${c.emoji}</div>
          <div class="urgent-info">
            <p class="urgent-name">${c.name} | ${lastMed.medicine}</p>
            <p class="urgent-sub">${subText}</p>
          </div>
          <button class="btn-done" onclick="App.openMedSheet();event.stopPropagation()">סומן ✓</button>
        </div>`;
      urgentEl.style.display = '';
    } else {
      urgentEl.style.display = 'none';
    }

    // ---------- child cards — שלב 2: מבוסס childStatusViewModel ----------
    const childCount = state.children.length;
    wrap.innerHTML = state.children.map((c, idx) => {
      const vm = childStatusViewModel(c.id);
      const isLastOdd = childCount % 2 !== 0 && idx === childCount - 1;

      // ── badges ──
      const suppIds = ['vitamin_d_drops', 'iron_drops'];
      const suppLabels = { vitamin_d_drops: { emoji: '☀️', name: 'ויטמין D' }, iron_drops: { emoji: '🩸', name: 'ברזל' } };
      const activeSupps = DB.get().prescriptions.filter(
        (p) => p.childId === c.id && suppIds.includes(p.productId) && p.status === 'active'
      );
      let badgesHtml;
      if (vm.tags.length) {
        badgesHtml = vm.tags.map(t =>
          t.type === 'fever'
            ? `<div class="status-pill fever"><div class="status-dot-sm"></div><span class="status-pill-text">• חום</span></div>`
            : `<div class="status-pill treatment"><div class="status-dot-sm"></div><span class="status-pill-text">• טיפול</span></div>`
        ).join('');
      } else {
        badgesHtml = `<div class="status-pill ok"><div class="status-dot-sm"></div><span class="status-pill-text">• הכל תקין</span></div>`;
      }
      // תג supplement — ☀️ / 🩸
      if (activeSupps.length) {
        badgesHtml += activeSupps.map(rx => {
          const lbl = suppLabels[rx.productId] || { emoji: '💊', name: '' };
          return `<div class="status-pill supplement"><div class="status-dot-sm"></div><span class="status-pill-text">${lbl.emoji} ${lbl.name}</span></div>`;
        }).join('');
      }

      // ── שורת תרופה ──
      let medRowHtml = '';
      if (vm.lastMed && (vm.prnActive || vm.courseState.hasActiveCourse)) {
        medRowHtml = `<div class="cc-row">
          <span class="cc-ic">💊</span>
          <span class="cc-lbl">${vm.lastMed.medicine || 'תרופה'}</span>
          <span class="cc-val cc-val-blue">${formatClock(vm.lastMed.time)}</span>
        </div>`;
      }

      // ── שורת חום ──
      let tempRowHtml = '';
      if (vm.hasFever) {
        const elapsed = elapsedString(vm.lastTemp.time);
        tempRowHtml = `<div class="cc-row">
          <span class="cc-ic">🌡️</span>
          <span class="cc-lbl">חום · לפני ${elapsed}</span>
          <span class="cc-val cc-val-red">${vm.lastTemp.value}°</span>
        </div>`;
      }

      // ── שורת supplement ──
      let suppRowHtml = '';
      if (activeSupps.length) {
        const suppRows = activeSupps.map(rx => {
          const lbl = suppLabels[rx.productId] || { emoji: '💊', name: rx.productId };
          const lastGiven = DB.get().medEntries
            .filter(e => e.childId === c.id && e.medicine === lbl.name)
            .sort((a, b) => b.time - a.time)[0] || null;
          const today = new Date(); today.setHours(0,0,0,0);
          const givenToday = lastGiven && lastGiven.time >= today.getTime();
          const statusHtml = givenToday
            ? `<button class="cc-supp-btn cc-supp-btn--done">✓ ניתן</button>`
            : `<button onclick="App.markSupplementGiven('${rx.id}',this);event.stopPropagation()" class="cc-supp-btn">תן ✓</button>`;
          return `<div class="cc-row">
            <span class="cc-ic">${lbl.emoji}</span>
            <span class="cc-lbl">${lbl.name}</span>
            ${statusHtml}
          </div>`;
        }).join('');
        suppRowHtml = suppRows;
      }

      // ── שורת מנה הבאה — min מכל הטיפולים ──
      let nextDoseRowHtml = '';
      {
        let nextAtMs = null;
        if (vm.nextEvent && vm.nextEvent.at && !vm.nextEvent.canGive) nextAtMs = vm.nextEvent.at;
        if (vm.courseState.hasActiveCourse) {
          vm.courseState.activeCourses.forEach(rx => {
            if (_canMarkDoseNow(rx) || _courseIsDoseOverdue(rx)) {
              if (nextAtMs === null) nextAtMs = Date.now();
            } else {
              const at = _courseNextDoseAt(rx);
              if (at && (nextAtMs === null || at < nextAtMs)) nextAtMs = at;
            }
          });
        }
        if (nextAtMs !== null) {
          const remaining = nextAtMs - Date.now();
          let valHtml;
          if (remaining <= 0) {
            valHtml = `<span class="cc-val cc-val-green">עכשיו</span>`;
          } else {
            const h = Math.floor(remaining / 3600000);
            const m = Math.floor((remaining % 3600000) / 60000);
            const label = h > 0 ? `${h}:${String(m).padStart(2,'0')}` : `${m} דק'`;
            valHtml = `<span class="cc-val cc-val-normal">${label}</span>`;
          }
          nextDoseRowHtml = `<div class="cc-row">
            <span class="cc-ic">⏰</span>
            <span class="cc-lbl">מנה הבאה</span>
            ${valHtml}
          </div>`;
        }
      }

      const avatarColors = ['avatar-pink','avatar-blue','avatar-green','avatar-pink','avatar-blue'];
      const avatarClass = avatarColors[c.color % avatarColors.length] || 'avatar-blue';
      const isCalm = !vm.hasFever && !vm.courseState.hasActiveCourse;

      const ageText = c.birthdate ? (() => {
        const diff = Date.now() - new Date(c.birthdate).getTime();
        const years = Math.floor(diff / (365.25 * 24 * 3600 * 1000));
        return years > 0 ? `${years} שנים` : 'פחות משנה';
      })() : '';

      // avatar ring — ירוק במצב calm
      const avatarStyle = isCalm
        ? 'margin:0 auto 8px;outline:3px solid #22c55e;outline-offset:2px;'
        : 'margin:0 auto 8px;';

      // ימים בריא — רק במצב calm
      let healthyRowHtml = '';
      if (isCalm && vm.healthyDays !== null && vm.healthyDays >= 0) {
        const gender = c.gender === 'male' ? 'בריא' : 'בריאה';
        healthyRowHtml = `<div class="cc-healthy">
          <div class="cc-healthy-num">${vm.healthyDays}</div>
          <div class="cc-healthy-lbl">ימים ${gender}</div>
        </div>`;
      }

      const hasRows = medRowHtml || tempRowHtml || nextDoseRowHtml || suppRowHtml;
      const cardInner = `
        <div class="cc-top">
          <div class="avatar-lg ${avatarClass}" style="${avatarStyle}">${c.emoji}</div>
          <div class="child-name">${c.name}</div>
          ${ageText ? `<div class="child-age">${ageText}</div>` : ''}
          <div class="cc-badges">${badgesHtml}</div>
        </div>
        ${hasRows ? `<div class="cc-rows">${medRowHtml}${tempRowHtml}${nextDoseRowHtml}${suppRowHtml}</div>` : ''}
        ${healthyRowHtml}`;

      const isSelected = c.id === selectedChildId;
      return `<div class="card${isLastOdd ? ' card-full' : ''}${isSelected ? ' card-selected' : ''}" onclick="App.selectChild('${c.id}')">
        ${cardInner}
      </div>`;
    }).join('');

    // ---------- fever tracker card (v2 mockup) ----------
    // fever tracker — הוסר (המידע מוצג בכרטיסי הילדים)
    const feverTrackerEl = document.getElementById('dash-fever-tracker');
    if (feverTrackerEl) feverTrackerEl.style.display = 'none';

    // ---------- tip card (v2 mockup) ----------
    const tipEl = document.getElementById('dash-tip-card');
    const tipKid = childData.find((d) => d.hasFever);
    if (tipKid && tipKid.lastTemp) {
      const tipVal = tipKid.lastTemp.value;
      const tipText = tipVal < 39
        ? 'בחום מתחת ל‑39°C מומלץ לוודא שתיית נוזלים מרובה ומנוחה. אם החום עולה — פנו לרופא.'
        : 'חום מעל 39°C דורש תשומת לב. מומלץ לפנות לרופא ולא לתת תרופות ללא הנחיה רפואית.';
      tipEl.innerHTML = `
        <div class="tip-card-v2">
          <div class="tip-icon-box">💡</div>
          <div>
            <p class="tip-title-v2">טיפ לבריאות היום</p>
            <p class="tip-body-v2">${tipText}</p>
          </div>
        </div>`;
      tipEl.style.display = '';
    } else {
      tipEl.style.display = 'none';
    }

    // ---------- timeline (last 3 events) ----------
    const feedBase = DB.feed(null);
    // inject course dose entries
    const courseDoseEntries = [];
    state.prescriptions.filter((p) => p.isCourse && p.doseLog && p.doseLog.length).forEach((rx) => {
      const entry = _catalogEntryById(rx.productId);
      const drugName = entry ? entry.key : 'תרופה';
      rx.doseLog.forEach((d) => {
        courseDoseEntries.push({ kind: 'course-dose', childId: rx.childId, time: d.at, medicine: drugName, reason: rx.reason || '' });
      });
    });
    const feed = [...feedBase, ...courseDoseEntries].sort((a, b) => b.time - a.time).slice(0, 3);
    const tlCard = document.getElementById('dash-timeline');
    if (feed.length) {
      document.getElementById('dash-tl-rows').innerHTML = feed.map((e) => {
        const child = state.children.find((c) => c.id === e.childId);
        const childName = child ? child.name : '';
        const ic = e.kind === 'temp' ? '🌡️' : '💊';
        const txt = e.kind === 'temp' ? `${e.value}°` : `${e.medicine}${e.dose ? ' ' + e.dose : ''}${e.reason ? ' · ' + e.reason : ''}`;
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

    // _renderActiveTreatmentsCard removed — treatment info moved into child card + detail panel
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
      remLabel.style.display = '';
      remChips.style.display = '';
      _updateReminderUI(); // decides auto/custom (PRN) vs recurring toggle (daily) based on the medicine itself
    }
    openSheet('sheet-med');
  }
  function pickMedChild(id) {
    medChildSel = id;
    document.querySelectorAll('#med-child-chips .chip').forEach((el) => el.classList.toggle('sel', el.dataset.id === id));
    if (!editMedEntryId) _updateReminderUI(); // daily-reminder default depends on this child's existing prescriptions
  }
  function pickMedMedicine(name) {
    medMedicineSel = name;
    document.querySelectorAll('#med-medicine-chips .chip').forEach((el) => el.classList.toggle('sel', el.textContent === name));
    if (!editMedEntryId) _updateReminderUI(); // the medicine's protocol type decides which reminder UI to show
  }
  /* the medicine picked decides the reminder UI, not the user: PRN meds get the auto/custom picker,
     DAILY meds get a simple recurring-reminder toggle (and default it from any existing prescription) */
  function _updateReminderUI() {
    const remLabel = document.getElementById('med-reminder-label');
    const remChips = document.getElementById('med-reminder-chips');
    const remCustom = document.getElementById('med-reminder-custom');
    if (!remLabel) return;
    const catalogEntry = _catalogEntryFor(medMedicineSel);

    if (catalogEntry && catalogEntry.protocol.type === TREATMENT_TYPES.DAILY) {
      const existing = medChildSel ? DB.get().prescriptions.find((p) => p.childId === medChildSel && p.productId === catalogEntry.id && p.status === 'active') : null;
      dailyReminderOn = existing ? existing.reminder.on !== false : true;
      remLabel.textContent = 'תזכורת יומית';
      remCustom.style.display = 'none';
      remChips.innerHTML = `
        <button type="button" class="chip ${dailyReminderOn ? 'sel' : ''}" onclick="App.toggleDailyReminder(true)">🔁 להזכיר כל יום</button>
        <button type="button" class="chip ${!dailyReminderOn ? 'sel' : ''}" onclick="App.toggleDailyReminder(false)">🚫 בלי תזכורת קבועה</button>`;
    } else {
      remLabel.textContent = 'תזכורת למנה הבאה';
      doseReminderMode = 'auto';
      remCustom.value = '';
      remCustom.style.display = 'none';
      _renderReminderChips();
    }
  }
  function toggleDailyReminder(on) {
    dailyReminderOn = on;
    _updateReminderUI();
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
        const drugKey = Object.keys(MEDICATION_CATALOG).find((k) => _matchesDrug(medMedicineSel, k));
        const drug = drugKey ? MEDICATION_CATALOG[drugKey] : null;
        const baseTime = timeToToday(document.getElementById('med-time').value || nowHHMM());
        const guess = baseTime + (drug && drug.protocol.intervalHours != null ? drug.protocol.intervalHours : 4) * 3600000;
        customInput.value = _toDatetimeLocal(guess);
      }
    } else {
      customInput.style.display = 'none';
    }
  }
  /* finds an earlier, still-pending (not yet fired) reminder for the same child+substance so it can be
     cancelled before scheduling a new one — this is what prevents two near-simultaneous pushes.
     matchFn is _matchesIngredient when we know the active ingredient (catches Acamol+Novimol as one
     substance), or _matchesDrug as a fallback for medicines not yet in the catalog. */
  function _findPendingReminder(childId, key, matchFn, excludeEntryId) {
    const now = Date.now();
    const candidates = DB.get().medEntries.filter((e) =>
      e.id !== excludeEntryId && e.childId === childId && matchFn(e.medicine, key) &&
      e.reminderNotificationId && e.reminderReadyAt && e.reminderReadyAt > now
    );
    if (!candidates.length) return null;
    return candidates.reduce((a, b) => (b.time > a.time ? b : a));
  }
  function _cancelReminder(notificationId) {
    if (!notificationId) return Promise.resolve();
    return fetch(`/api/notify?id=${encodeURIComponent(notificationId)}`, { method: 'DELETE' }).catch(() => {});
  }

  /* Cancel a pending course-dose push (stored on the prescription as courseNotificationId). */
  async function _cancelCourseReminder(rx) {
    if (!rx || !rx.courseNotificationId) return;
    await _cancelReminder(rx.courseNotificationId);
    DB.updatePrescription(rx.id, { courseNotificationId: null, courseReminderAt: null });
  }

  /* Schedule a push for the next course dose.
     Interval = 24h / dosesPerDay from the moment the dose was just marked.
     Does nothing if: notifications off, course completed, or scheduledTime already passed. */
  async function _scheduleCourseReminder(rx) {
    if (!DB.get().settings.notifications) return;
    if (!rx || rx.status === 'completed') return;
    const intervalMs  = (24 / (rx.dosesPerDay || 1)) * 3600 * 1000;
    const lastDoseAt  = rx.doseLog && rx.doseLog.length ? rx.doseLog[rx.doseLog.length - 1].at : Date.now();
    const readyAt     = lastDoseAt + intervalMs;
    if (readyAt <= Date.now()) return;

    // cancel previous pending reminder for this prescription before scheduling a new one
    await _cancelCourseReminder(rx);

    const entry   = _catalogEntryById(rx.productId);
    const drug    = entry ? entry.key : 'תרופה';
    const child   = childById(rx.childId);
    const childName = child ? child.name : 'הילד/ה';

    try {
      const res = await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `זמן למנה הבאה 💊`,
          message: `הגיע הזמן לתת ל${childName} מנה של ${drug}`,
          childName,
          scheduledTime: new Date(readyAt).toISOString(),
          targetDeviceId: DB.get().deviceId,
        }),
      });
      const data = await res.json().catch(() => null);
      if (data && data.notificationId) {
        DB.updatePrescription(rx.id, {
          courseNotificationId: data.notificationId,
          courseReminderAt: readyAt,
        });
      }
    } catch (e) { /* best-effort — never block UI */ }
  }
  /* Cancel a pending supplement push (stored on the prescription as supplementNotificationId). */
  async function _cancelSupplementReminder(rx) {
    if (!rx || !rx.supplementNotificationId) return;
    await _cancelReminder(rx.supplementNotificationId);
    DB.updatePrescription(rx.id, { supplementNotificationId: null, supplementReminderAt: null });
  }

  /* Schedule a daily push for a supplement prescription (vitaminD / iron).
     readyAt = _nextFixedTime(rx.reminder.time) — fixed clock time, not +24h from now.
     Called:
       (a) when _saveSupplementPrescriptions() creates/updates the prescription
       (b) after the parent marks "given" (step 4/5) to schedule the NEXT day's reminder.
     Does nothing if: notifications off, rx inactive, or child has aged out. */
  async function scheduleSupplementReminder(rx) {
    console.log('[Supp] scheduleSupplementReminder →', rx.productId, '| notifications:', DB.get().settings.notifications, '| status:', rx?.status, '| reminder:', rx?.reminder);
    if (!DB.get().settings.notifications) { console.log('[Supp] ❌ notifications off'); return; }
    if (!rx || rx.status !== 'active') { console.log('[Supp] ❌ rx not active'); return; }
    if (!rx.reminder || !rx.reminder.on) { console.log('[Supp] ❌ reminder.on is false/missing'); return; }

    // age gate — cancel and return if child has aged out
    const child = childById(rx.childId);
    if (child && child.birthDate) {
      const ageMonths = calcAgeMonths(child.birthDate);
      if (rx.productId === 'vitamin_d_drops' && ageMonths >= 12) {
        await _cancelSupplementReminder(rx);
        DB.updatePrescription(rx.id, { status: 'completed', endAt: Date.now() });
        return;
      }
      if (rx.productId === 'iron_drops' && ageMonths >= 18) {
        await _cancelSupplementReminder(rx);
        DB.updatePrescription(rx.id, { status: 'completed', endAt: Date.now() });
        return;
      }
    }

    const readyAt = _nextFixedTime(rx.reminder.time || '08:00');
    console.log('[Supp] readyAt:', new Date(readyAt).toLocaleTimeString('he-IL'), '| now:', new Date().toLocaleTimeString('he-IL'), '| diff(min):', Math.round((readyAt - Date.now()) / 60000));
    if (readyAt <= Date.now()) { console.log('[Supp] ❌ readyAt in the past — skipping'); return; }

    // cancel previous pending push before scheduling a new one
    await _cancelSupplementReminder(rx);

    const entry     = _catalogEntryById(rx.productId);
    const drugLabel = entry ? entry.key : 'תוסף';
    const childName = child ? child.name : 'הילד/ה';
    const emoji     = rx.productId === 'vitamin_d_drops' ? '☀️' : '🩸';

    try {
      console.log('[Supp] 📤 calling /api/notify for', rx.productId, '| scheduledTime:', new Date(readyAt).toISOString());
      const res = await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `תזכורת יומית ${emoji}`,
          message: `זמן לתת ל${childName} ${drugLabel}`,
          childName,
          scheduledTime: new Date(readyAt).toISOString(),
          targetDeviceId: DB.get().deviceId,
        }),
      });
      const data = await res.json().catch(() => null);
      console.log('[Supp] /api/notify response:', res.status, data);
      if (data && data.notificationId) {
        DB.updatePrescription(rx.id, {
          supplementNotificationId: data.notificationId,
          supplementReminderAt: readyAt,
        });
        console.log('[Supp] ✅ scheduled notificationId:', data.notificationId);
      } else {
        console.log('[Supp] ⚠️ no notificationId in response');
      }
    } catch (e) { console.log('[Supp] ❌ fetch error:', e.message); }
  }

  async function scheduleDoseReminder(entry, customReadyAt) {
    if (!entry || !DB.get().settings.notifications) return; // user opted out — don't schedule
    const drugKey = Object.keys(MEDICATION_CATALOG).find((k) => _matchesDrug(entry.medicine, k));
    const drug = drugKey ? MEDICATION_CATALOG[drugKey] : null;
    const ingredientKey = drug ? drug.activeIngredient : null;

    let readyAt = customReadyAt;
    if (readyAt == null) {
      if (drug && drug.protocol.type === TREATMENT_TYPES.DAILY) {
        readyAt = entry.time + 24 * 3600000; // once-a-day meds — remind at the same time tomorrow
      } else if (drug && drug.protocol.intervalHours != null) {
        readyAt = entry.time + drug.protocol.intervalHours * 3600000;
      } else {
        return; // no known interval and no manual time — nothing to schedule
      }
    }
    if (readyAt <= Date.now()) return; // time already passed — don't schedule in the past

    // avoid duplicate pushes: if an earlier dose of the same active ingredient (across brands) for
    // this child still has a pending reminder, cancel it first — the new dose supersedes it
    if (ingredientKey) {
      const pending = _findPendingReminder(entry.childId, ingredientKey, _matchesIngredient, entry.id);
      if (pending) {
        await _cancelReminder(pending.reminderNotificationId);
        DB.updateMedEntry(pending.id, { reminderNotificationId: null, reminderReadyAt: null });
      }
    } else if (drugKey) {
      const pending = _findPendingReminder(entry.childId, drugKey, _matchesDrug, entry.id);
      if (pending) {
        await _cancelReminder(pending.reminderNotificationId);
        DB.updateMedEntry(pending.id, { reminderNotificationId: null, reminderReadyAt: null });
      }
    }

    const child = childById(entry.childId);
    try {
      const res = await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'זמן למנה הבאה 💊',
          message: `אפשר לתת ל${child ? child.name : 'הילד/ה'} מנה נוספת של ${entry.medicine}`,
          childName: child ? child.name : undefined,
          scheduledTime: new Date(readyAt).toISOString(),
          medEntryId: entry.id, // for debugging/data payload only — NOT used for targeting
          targetDeviceId: DB.get().deviceId, // who the push should actually be delivered to
        }),
      });
      const data = await res.json().catch(() => null);
      if (data && data.notificationId) {
        // store the id + time so a future dose of the same substance can find & cancel this one
        DB.updateMedEntry(entry.id, { reminderNotificationId: data.notificationId, reminderReadyAt: readyAt });
      }
    } catch (e) { /* best-effort — never block the UI on a failed schedule call */ }
  }

  async function saveMed() {
    if (!medChildSel) { toast('אין ילד לבחור — הוסיפו ילד/ה קודם'); return; }
    const catalogEntry = _catalogEntryFor(medMedicineSel);
    const protocolType = catalogEntry ? catalogEntry.protocol.type : null;
    const drugKey = Object.keys(MEDICATION_CATALOG).find((k) => _matchesDrug(medMedicineSel, k));

    // warn (not block) if a dose of the same substance was already given too recently / already
    // given today (for daily meds) — same check the dose calculator uses, now applied here too
    if (!editMedEntryId && drugKey) {
      const warning = _doseHistoryWarning(medChildSel, drugKey);
      if (warning && warning.level === 'alert') {
        const plain = warning.text.replace(/^[⏱️⚠️☀️]\s*/, '');
        if (!confirm(`${plain}\n\nלהמשיך בכל זאת ולרשום את המנה?`)) return;
      }
    }

    const patch = {
      childId: medChildSel,
      medicine: medMedicineSel || 'תרופה',
      dose: document.getElementById('med-dose').value.trim(),
      note: document.getElementById('med-note').value.trim(),
      time: timeToToday(document.getElementById('med-time').value || nowHHMM()),
    };
    try {
      if (editMedEntryId) {
        DB.updateMedEntry(editMedEntryId, patch);
        toast('התרופה עודכנה ✓');
      } else {
        // DAILY-protocol meds: upsert a Prescription representing "ongoing daily treatment" for this
        // child+medicine, so future work (dashboard list, etc.) has a real place to read it from.
        // References the catalog by stable productId, never copies its protocol values.
        if (protocolType === TREATMENT_TYPES.DAILY && catalogEntry) {
          const existingRx = DB.get().prescriptions.find((p) => p.childId === medChildSel && p.productId === catalogEntry.id && p.status === 'active');
          if (existingRx) {
            DB.updatePrescription(existingRx.id, { reminder: { on: dailyReminderOn } });
            patch.prescriptionId = existingRx.id;
          } else {
            const rx = DB.addPrescription({
              childId: medChildSel,
              productId: catalogEntry.id,
              ingredientId: catalogEntry.activeIngredient,
              protocolType: TREATMENT_TYPES.DAILY,
              reminder: { on: dailyReminderOn },
            });
            patch.prescriptionId = rx.id;
          }
        }

        const entry = DB.addMedEntry(patch);
        let customReadyAt = null;
        if (doseReminderMode === 'custom') {
          const val = document.getElementById('med-reminder-custom').value;
          if (val) customReadyAt = new Date(val).getTime(); // parsed as local time, as entered
        }
        const shouldSchedule = protocolType === TREATMENT_TYPES.DAILY ? dailyReminderOn : true;
        if (shouldSchedule) scheduleDoseReminder(entry, customReadyAt); // falls back to automatic timing if no custom time was set
        toast('התרופה נשמרה ✓');
      }
    } catch (e) {
      // localStorage write failed (quota exceeded, private browsing, etc.) — don't claim success,
      // don't close the sheet, so the user doesn't lose what they just filled in
      toast('⚠️ השמירה נכשלה — בדקו מקום פנוי במכשיר ונסו שוב');
      return;
    }
    editMedEntryId = null;
    closeSheet('sheet-med');
    renderDashboard();
    renderHistory();
  }
  function deleteMedEntry() {
    if (!editMedEntryId) return;
    if (!confirm('למחוק את הרשומה הזו? הפעולה אינה הפיכה.')) return;
    const entry = DB.get().medEntries.find((e) => e.id === editMedEntryId);
    if (entry && entry.reminderNotificationId && entry.reminderReadyAt && entry.reminderReadyAt > Date.now()) {
      _cancelReminder(entry.reminderNotificationId); // dose record is gone — its reminder shouldn't fire either
    }
    try {
      DB.deleteMedEntry(editMedEntryId);
    } catch (e) {
      toast('⚠️ המחיקה נכשלה — נסו שוב');
      return;
    }
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

    // completed courses — inject into feed as synthetic entries
    const completedCourses = state.prescriptions.filter(
      (p) => p.isCourse && p.status === 'completed' &&
             (histFilter === 'all' || p.childId === histFilter)
    );
    const courseEntries = completedCourses.map((rx) => {
      const entry = _catalogEntryById(rx.productId);
      const drugName = entry ? entry.key : 'טיפול';
      const startStr = new Date(rx.startAt).toLocaleDateString('he-IL');
      const endStr   = rx.endAt ? new Date(rx.endAt).toLocaleDateString('he-IL') : '—';
      const totalDoses = (rx.totalDays || 0) * (rx.dosesPerDay || 1);
      const dosesDone  = rx.doseLog ? rx.doseLog.length : 0;
      return {
        id: rx.id,
        kind: 'course',
        childId: rx.childId,
        time: rx.endAt || rx.startAt,
        drugName,
        startStr,
        endStr,
        totalDays: rx.totalDays,
        dosesPerDay: rx.dosesPerDay,
        dosesDone,
        totalDoses,
      };
    });

    const combined = [...feed, ...courseEntries].sort((a, b) => b.time - a.time);
    const list = document.getElementById('hist-list');
    if (!combined.length) {
      list.innerHTML = `<div class="empty-state"><div class="ic">📭</div><div class="t">אין עדיין רשומות</div><div class="s">תרופות ומדידות שיתווספו יופיעו כאן</div></div>`;
      return;
    }
    let lastLabel = null;
    let html = '';
    combined.forEach((e) => {
      const label = dayLabel(e.time);
      if (label !== lastLabel) { html += `<div class="day-label">${label}</div>`; lastLabel = label; }
      const c = childById(e.childId);
      if (!c) return;
      if (e.kind === 'course') {
        html += `<div class="hist-row">
          <div class="hist-time">${formatClock(e.time)}</div>
          <div class="hist-icon" style="background:${AVATAR_GRADIENT[c.color]}">✅</div>
          <div class="hist-main">
            <div class="hist-med">טיפול הושלם · ${e.drugName}</div>
            <div class="hist-child">${c.name} · ${e.totalDays} ימים · ${e.dosesPerDay} מנות/יום · ${e.dosesDone}/${e.totalDoses} מנות · ${e.startStr}–${e.endStr}</div>
          </div>
        </div>`;
        return;
      }
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
    try {
      if (editTempEntryId) {
        DB.updateTempEntry(editTempEntryId, patch);
        toast('המדידה עודכנה ✓');
      } else {
        DB.addTempEntry(patch);
        toast('המדידה נשמרה ✓');
      }
    } catch (e) {
      toast('⚠️ השמירה נכשלה — בדקו מקום פנוי במכשיר ונסו שוב');
      return;
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
    try {
      DB.deleteTempEntry(editTempEntryId);
    } catch (e) {
      toast('⚠️ המחיקה נכשלה — נסו שוב');
      return;
    }
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
  /* ── שלב 3: Selected Child Panel — Bottom Sheet ─────────────────────────── */
  function selectChild(id) {
    console.log('[DEBUG] selectChild called:', id);
    const sheetEl = document.getElementById('sheet-child-detail');
    console.log('[DEBUG] sheetEl:', sheetEl, 'classes:', sheetEl?.className);
    const isOpen = sheetEl.classList.contains('open');
    const isSameChild = selectedChildId === id;
    selectedChildId = id;

    if (isOpen && !isSameChild) {
      // מעבר בין ילדים — Slide עדין
      const content = document.getElementById('sheet-child-detail-content');
      if (content && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        content.style.transition = 'opacity 140ms ease, transform 140ms ease';
        content.style.opacity = '0';
        content.style.transform = 'translateX(20px)';
        setTimeout(() => {
          _renderSelectedChildPanel();
          content.style.transition = 'none';
          content.style.transform = 'translateX(-20px)';
          requestAnimationFrame(() => requestAnimationFrame(() => {
            content.style.transition = 'opacity 180ms ease, transform 180ms ease';
            content.style.opacity = '1';
            content.style.transform = 'translateX(0)';
          }));
        }, 150);
        return;
      }
    }
    _renderSelectedChildPanel();
    if (!isOpen) openSheet('sheet-child-detail');
  }

  function closeChildDetail() {
    closeSheet('sheet-child-detail');
    selectedChildId = null;
    // הסר card-selected highlight
    document.querySelectorAll('.child-grid .card-selected')
      .forEach(el => el.classList.remove('card-selected'));
  }

  function _renderSelectedChildPanel() {
    const el = document.getElementById('sheet-child-detail-content');
    if (!el || !selectedChildId) return;

    const c = childById(selectedChildId);
    if (!c) return;

    const vm = childStatusViewModel(selectedChildId);

    // pills
    let pillsHtml = '';
    if (vm.tags.length) {
      pillsHtml = vm.tags.map(t =>
        t.type === 'fever'
          ? `<div class="status-pill fever"><div class="status-dot-sm"></div><span class="status-pill-text">• חום</span></div>`
          : `<div class="status-pill treatment"><div class="status-dot-sm"></div><span class="status-pill-text">• טיפול</span></div>`
      ).join('');
    } else {
      pillsHtml = `<div class="status-pill ok"><div class="status-dot-sm"></div><span class="status-pill-text">🟢 הכל תקין</span></div>`;
    }

    // חום אחרון
    let feverRow = '';
    if (vm.lastTemp) {
      const when = formatClock(vm.lastTemp.time);
      const elapsed = elapsedString(vm.lastTemp.time);
      const cls = vm.hasFever ? 'scp-row-alert' : 'scp-row-normal';
      feverRow = `<div class="scp-row ${cls}">
        <span class="scp-row-ic">🌡️</span>
        <span class="scp-row-lbl">חום אחרון · לפני ${elapsed}</span>
        <span class="scp-row-val">${vm.lastTemp.value}° בשעה ${when}</span>
      </div>`;
    }

    // תרופה / canGive
    let medRow = '';
    if (vm.nextEvent && vm.nextEvent.type === 'prn') {
      const ev = vm.nextEvent;
      const statusHtml = ev.canGive
        ? `<span class="scp-row-val scp-val-green">אפשר לתת עכשיו</span>`
        : `<span class="scp-row-val">ניתן לתת ב־${formatClock(ev.at)}</span>`;
      medRow = `<div class="scp-row scp-row-normal" style="flex-wrap:wrap;gap:6px;">
        <span class="scp-row-ic">💊</span>
        <span class="scp-row-lbl">${ev.name}</span>
        ${statusHtml}
        <button onclick="App.doneWithPRN('${selectedChildId}')" style="margin-top:4px;width:100%;padding:7px;border-radius:10px;border:1.5px solid #e5e7eb;background:#fff;color:#6b7280;font-size:13px;font-weight:600;cursor:pointer;">סיימתי עם ${ev.name}</button>
      </div>`;
    } else if (vm.lastMed && vm.prnActive) {
      medRow = `<div class="scp-row scp-row-normal" style="flex-wrap:wrap;gap:6px;">
        <span class="scp-row-ic">💊</span>
        <span class="scp-row-lbl">תרופה אחרונה</span>
        <span class="scp-row-val">${vm.lastMed.medicine} — ${formatClock(vm.lastMed.time)}</span>
        <button onclick="App.doneWithPRN('${selectedChildId}')" style="margin-top:4px;width:100%;padding:7px;border-radius:10px;border:1.5px solid #e5e7eb;background:#fff;color:#6b7280;font-size:13px;font-weight:600;cursor:pointer;">סיימתי עם ${vm.lastMed.medicine}</button>
      </div>`;
    }

    // course פעיל — section מורחב
    let courseRow = '';
    if (vm.courseState.hasActiveCourse) {
      const courseRows = vm.courseState.activeCourses.map(rx => {
        const entry = _catalogEntryById(rx.productId);
        const name = entry ? entry.key : 'טיפול';
        const summary = _courseSummary(rx);
        const canMark = _canMarkDoseNow(rx);
        const nextAt = _courseNextDoseAt(rx);
        const isOverdue = _courseIsDoseOverdue(rx);

        let timerText = '';
        if (canMark || isOverdue) {
          timerText = `<span style="color:var(--mint);font-weight:600;">🟢 זמין עכשיו</span>`;
        } else if (nextAt) {
          const remaining = nextAt - Date.now();
          if (remaining > 0) {
            const hrs  = Math.floor(remaining / 3600000);
            const mins = Math.floor((remaining % 3600000) / 60000);
            const t = hrs > 0
              ? `${hrs} שעות${mins > 0 ? ' ו-' + mins + ' דקות' : ''}`
              : `${mins} דקות`;
            timerText = `<span style="color:var(--ink-soft);">⏱ מנה הבאה בעוד ${t}</span>`;
          }
        }

        const markBtn = canMark || isOverdue
          ? `<button onclick="App.markCourseDose('${rx.id}')" style="margin-top:8px;padding:6px 16px;border-radius:10px;border:none;background:var(--accent,#4a90d9);color:#fff;font-size:14px;cursor:pointer;width:100%;">✓ סימון מנה</button>`
          : `<button disabled style="margin-top:8px;padding:6px 16px;border-radius:10px;border:none;background:#e0e0e0;color:#aaa;font-size:14px;cursor:not-allowed;width:100%;">✓ סימון מנה</button>`;

        const doneBtn = `<button onclick="App.doneWithCourse('${rx.id}')" style="margin-top:6px;padding:6px 16px;border-radius:10px;border:1.5px solid #e5e7eb;background:#fff;color:#6b7280;font-size:13px;font-weight:600;cursor:pointer;width:100%;">סיימתי עם ${name}</button>`;

        return `<div style="padding:10px 0;border-top:1px solid var(--line);">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div style="font-weight:600;">💊 ${name}</div>
            ${isOverdue ? `<span style="color:var(--coral,#e57373);font-size:12px;">⚠️ באיחור</span>` : ''}
          </div>
          <div style="font-size:13px;color:var(--ink-soft);margin-top:2px;">${summary}</div>
          <div style="font-size:13px;margin-top:4px;">${timerText}</div>
          ${markBtn}
          ${doneBtn}
        </div>`;
      }).join('');

      courseRow = `<div style="padding:4px 0;">
        <div style="font-size:12px;font-weight:700;color:var(--ink-soft);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px;">טיפולים פעילים</div>
        ${courseRows}
      </div>`;
    }

    // supplement rows for detail panel
    let supplementRow = '';
    {
      const suppIds = ['vitamin_d_drops', 'iron_drops'];
      const suppLabels = { vitamin_d_drops: { emoji: '☀️', name: 'ויטמין D' }, iron_drops: { emoji: '🩸', name: 'ברזל' } };
      const activeSupps = DB.get().prescriptions.filter(
        (p) => p.childId === selectedChildId && suppIds.includes(p.productId) && p.status === 'active'
      );
      if (activeSupps.length) {
        const rows = activeSupps.map((rx) => {
          const lbl = suppLabels[rx.productId] || { emoji: '💊', name: rx.productId };
          const lastGiven = DB.get().medEntries
            .filter((e) => e.childId === selectedChildId && e.medicine === lbl.name)
            .sort((a, b) => b.time - a.time)[0] || null;
          const givenToday = lastGiven && new Date(lastGiven.time).toDateString() === new Date().toDateString();
          return `<div class="scp-row scp-row-normal" style="justify-content:space-between;">
            <span class="scp-row-ic">${lbl.emoji}</span>
            <span class="scp-row-lbl" style="flex:1;">${lbl.name}</span>
            ${givenToday
              ? `<span class="scp-row-val scp-val-green">✓ ניתן היום</span>`
              : `<button onclick="App.markSupplementGiven('${selectedChildId}','${rx.productId}')" style="padding:5px 12px;border-radius:10px;border:none;background:var(--mint,#10b981);color:#fff;font-size:12px;font-weight:600;cursor:pointer;">ניתן עכשיו ✓</button>`
            }
          </div>`;
        }).join('');
        supplementRow = `<div style="padding:4px 0;">
          <div style="font-size:12px;font-weight:700;color:var(--ink-soft);margin-bottom:2px;">תוספים יומיים</div>
          ${rows}
        </div>`;
      }
    }

    const avatarColors = ['avatar-pink','avatar-blue','avatar-green','avatar-pink','avatar-blue'];
    const avatarClass = avatarColors[c.color % avatarColors.length] || 'avatar-blue';

    el.innerHTML = `
      <div class="scp-header">
        <div class="scp-title-row">
          <div class="avatar-md ${avatarClass}">${c.emoji}</div>
          <div class="scp-name">${c.name}</div>
        </div>
        <div class="scp-pills">${pillsHtml}</div>
      </div>
      <div class="scp-rows">
        ${feverRow}
        ${medRow}
        ${courseRow}
        ${supplementRow}
        ${!feverRow && !medRow && !courseRow && !supplementRow ? `<div class="scp-empty">אין נתונים אחרונים לילד/ה זה</div>` : ''}
      </div>
      <div class="scp-actions">
        <button class="scp-btn scp-btn-primary" onclick="App.openMedSheet()">💊 נתתי תרופה</button>
        <button class="scp-btn scp-btn-secondary" onclick="App.openTempSheet()">🌡️ מדדתי חום</button>
        <button class="scp-btn scp-btn-ghost" onclick="App.openEditKid('${c.id}')">✏️ עריכה</button>
      </div>`;
  }
  /* ── end שלב 3 ──────────────────────────────────────────────────────────── */

  /* Called when parent taps "✓ ניתן עכשיו" on a supplement in the child detail panel.
     1. Logs a medEntry (appears in history just like any medicine).
     2. Schedules the next day's push at the same fixed time.
     3. Refreshes the detail panel. */
  async function markSupplementGiven(rxId, btnEl) {
    // optimistic UI — מיידי, לפני async
    if (btnEl && btnEl.classList) {
      btnEl.textContent = '✓ ניתן';
      btnEl.classList.add('cc-supp-btn--done');
    }
    const rx = DB.get().prescriptions.find((p) => p.id === rxId);
    if (!rx) return;

    const suppLabels = { vitamin_d_drops: 'ויטמין D', iron_drops: 'ברזל' };
    const medicineName = suppLabels[rx.productId] || rx.productId;

    try {
      // log as a regular medEntry so it appears in history and feed
      DB.addMedEntry({
        childId: rx.childId,
        medicine: medicineName,
        prescriptionId: rx.id,    // links back to the prescription
        note: 'תוסף יומי',
        isSupp: true,             // exclude from lastMedFor / PRN logic
      });
    } catch (e) {
      toast('⚠️ השמירה נכשלה — בדקו מקום פנוי במכשיר ונסו שוב');
      return;
    }

    // schedule next day's push
    scheduleSupplementReminder(rx);

    toast(`${medicineName} נרשם ✓`);
    renderChildDetailPanel();
    renderDashboard();
    renderHistory();
  }

  function openEditKid(id) {
    editingKidId = id;
    const title = document.getElementById('editkid-title');
    const hint  = document.getElementById('kid-birth-year-hint'); // may be null on onboarding
    if (id) {
      const c = childById(id);
      title.textContent = 'עריכת פרטי ילד/ה';
      document.getElementById('kid-name').value   = c.name;
      document.getElementById('kid-weight').value = c.weight;
      if (c.birthDate) {
        document.getElementById('kid-birth').value = c.birthDate;
        if (hint) hint.style.display = 'none';
      } else {
        document.getElementById('kid-birth').value = '';
        if (hint) hint.style.display = c.birthYear ? 'block' : 'none';
      }
    } else {
      title.textContent = 'הוספת ילד/ה';
      document.getElementById('kid-name').value   = '';
      document.getElementById('kid-weight').value = '';
      document.getElementById('kid-birth').value  = '';
      if (hint) hint.style.display = 'none';
    }
    _refreshSupplementsUI(id);
    // re-evaluate age gates whenever the user changes the birth date
    const birthEl = document.getElementById('kid-birth');
    if (birthEl) birthEl.onchange = () => _refreshSupplementsUI(editingKidId);
    openSheet('sheet-editkid');
  }

  /* Show/hide the supplement toggles based on child's age and existing prescriptions. */
  function _refreshSupplementsUI(childId) {
    const section  = document.getElementById('kid-supplements-section');
    const vitdRow  = document.getElementById('kid-vitd-row');
    const ironRow  = document.getElementById('kid-iron-row');
    if (!section) return; // sheet not in DOM yet (shouldn't happen, but guard)

    const birthVal = document.getElementById('kid-birth').value; // may be empty for new kids
    const ageMonths = calcAgeMonths(birthVal || null);

    const showVitD = ageMonths === null || ageMonths < 12; // show if unknown age or under 12m
    const showIron = ageMonths === null || ageMonths < 18; // show if unknown age or under 18m

    vitdRow.style.display = showVitD ? '' : 'none';
    ironRow.style.display = showIron ? '' : 'none';
    section.style.display = (showVitD || showIron) ? '' : 'none';

    // Load existing prescription state
    const state = DB.get();
    const rxVitD = childId ? state.prescriptions.find(
      (p) => p.childId === childId && p.productId === 'vitamin_d_drops' && p.status === 'active'
    ) : null;
    const rxIron = childId ? state.prescriptions.find(
      (p) => p.childId === childId && p.productId === 'iron_drops' && p.status === 'active'
    ) : null;

    const vitdOn   = document.getElementById('kid-vitd-on');
    const vitdTime = document.getElementById('kid-vitd-time');
    const ironOn   = document.getElementById('kid-iron-on');
    const ironTime = document.getElementById('kid-iron-time');
    const vitdTimeRow = document.getElementById('kid-vitd-time-row');
    const ironTimeRow = document.getElementById('kid-iron-time-row');

    vitdOn.checked  = rxVitD ? !!(rxVitD.reminder && rxVitD.reminder.on) : true;
    vitdTime.value  = (rxVitD && rxVitD.reminder && rxVitD.reminder.time) || '08:00';
    vitdTimeRow.style.display = vitdOn.checked ? '' : 'none';

    ironOn.checked  = rxIron ? !!(rxIron.reminder && rxIron.reminder.on) : true;
    ironTime.value  = (rxIron && rxIron.reminder && rxIron.reminder.time) || '08:00';
    ironTimeRow.style.display = ironOn.checked ? '' : 'none';

    // Toggle time-row visibility when checkbox changes
    vitdOn.onchange = () => { vitdTimeRow.style.display = vitdOn.checked ? '' : 'none'; };
    ironOn.onchange = () => { ironTimeRow.style.display = ironOn.checked ? '' : 'none'; };
  }
  function saveKid() {
    const name       = document.getElementById('kid-name').value.trim();
    const weight     = parseFloat(document.getElementById('kid-weight').value);
    const birthInput = document.getElementById('kid-birth').value; // "YYYY-MM-DD" or ""
    if (!name) { toast('נא להזין שם'); return; }
    const birthDate = birthInput || null;
    const birthYear = birthDate
      ? parseInt(birthDate.slice(0, 4), 10)
      : (editingKidId ? (childById(editingKidId)?.birthYear ?? null) : null);
    const patch = { name, weight: isNaN(weight) ? 0 : weight, birthDate, birthYear };
    try {
      if (editingKidId) {
        DB.updateChild(editingKidId, patch);
      } else {
        DB.addChild({ ...patch, emoji: '🧒' });
      }
    } catch (e) {
      toast('⚠️ השמירה נכשלה — בדקו מקום פנוי במכשיר ונסו שוב');
      return;
    }

    // save supplement prescriptions if the section was visible
    const section = document.getElementById('kid-supplements-section');
    if (section && section.style.display !== 'none') {
      const childId = editingKidId || DB.get().children[DB.get().children.length - 1]?.id;
      if (childId) _saveSupplementPrescriptions(childId);
    }

    closeSheet('sheet-editkid');
    toast('הפרטים נשמרו ✓');
    renderKids();
    renderDashboard();
  }

  /* Upsert active supplement prescriptions based on the editkid toggles. */
  function _saveSupplementPrescriptions(childId) {
    const supplements = [
      { elOn: 'kid-vitd-on', elTime: 'kid-vitd-time', productId: 'vitamin_d_drops', label: 'ויטמין D', maxMonths: 12 },
      { elOn: 'kid-iron-on', elTime: 'kid-iron-time', productId: 'iron_drops',      label: 'ברזל',     maxMonths: 18 },
    ];

    const state = DB.get();
    supplements.forEach(({ elOn, elTime, productId, maxMonths }) => {
      const onEl   = document.getElementById(elOn);
      const timeEl = document.getElementById(elTime);
      if (!onEl) return; // element not in DOM (hidden or missing)

      const isOn = onEl.checked;
      const time = (timeEl && timeEl.value) || '08:00';

      const existingRx = state.prescriptions.find(
        (p) => p.childId === childId && p.productId === productId && p.status === 'active'
      );

      if (isOn) {
        let rx;
        if (existingRx) {
          rx = DB.updatePrescription(existingRx.id, { reminder: { on: true, time } });
        } else {
          rx = DB.addPrescription({
            childId,
            productId,
            protocolType: 'daily',
            isCourse: false,
            reminder: { on: true, time },
          });
        }
        if (rx) scheduleSupplementReminder(rx); // schedule first push (today or tomorrow at fixed time)
      } else {
        // user turned it off — cancel any pending push and mark reminder off
        if (existingRx) {
          _cancelSupplementReminder(existingRx);
          DB.updatePrescription(existingRx.id, { reminder: { on: false, time } });
        }
      }
    });
  }


  /* ---------- dose calculator ---------- */
  /* Active-ingredient layer (phase 1 of the medication architecture — see docs/medication-architecture.md).
     Safety checks (duplicate-dose warnings, reminder dedup) key off activeIngredient, not brand name,
     so e.g. Acamol + Novimol (both paracetamol) are correctly treated as the same substance. */
  const ACTIVE_INGREDIENTS = {
    paracetamol: { id: 'paracetamol', name: 'פרצטמול', aliases: [] },
    ibuprofen: { id: 'ibuprofen', name: 'איבופרופן', aliases: [] },
    vitaminD: { id: 'vitaminD', name: 'ויטמין D', aliases: ['ויטמין די'] },
    iron:     { id: 'iron',     name: 'ברזל',    aliases: ['ברזל לתינוקות'] },
  };

  /* Treatment protocol types (layer 3) — each is a different logical "engine" for timing/warnings.
     COURSE and WEEKLY are placeholders for phase 2 (not implemented yet — no product uses them). */
  const TREATMENT_TYPES = {
    PRN: 'prn',
    DAILY: 'daily',
    COURSE: 'course',
    WEEKLY: 'weekly',
    CUSTOM: 'custom',
  };

  /* Medication Catalog (layers 2+3): Product info (brand/matchNames/concentrations) + its default
     Protocol (timing/safety rules). See docs/medication-architecture.md for the full model.
     The object key is the Hebrew display name (used for free-text matching against medEntries) —
     `id` is the STABLE identifier that Prescriptions/future references should point to, since the
     display name is allowed to change but the id never should. */
  const MEDICATION_CATALOG = {
    'נובימול': {
      id: 'novimol_drops',
      activeIngredient: 'paracetamol',
      protocol: { version: 1, type: TREATMENT_TYPES.PRN, interval: '4–6 שעות', intervalHours: 4, maxDosesPerDay: 5 },
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
      id: 'acamol_syrup',
      activeIngredient: 'paracetamol',
      protocol: { version: 1, type: TREATMENT_TYPES.PRN, interval: null, intervalHours: null, maxDosesPerDay: null },
      matchNames: ['אקמול'],
      concentrations: [
        { label: 'ממתין לעלון רשמי', pendingLeaflet: true },
      ]
    },
    'נורופן': {
      id: 'nurofen_syrup',
      activeIngredient: 'ibuprofen',
      protocol: { version: 1, type: TREATMENT_TYPES.PRN, interval: '6–8 שעות (מרווח מינימלי 4 שעות)', intervalHours: 4, maxDosesPerDay: 4 },
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
    'ויטמין D': {
      id: 'vitamin_d_drops',
      activeIngredient: 'vitaminD',
      protocol: { version: 1, type: TREATMENT_TYPES.DAILY, dosesPerDay: 1 },
      matchNames: ['ויטמין D', 'ויטמין די', 'וויטמין D'],
      concentrations: [
        { label: 'ממתין לנתוני מינון רשמיים', pendingLeaflet: true },
      ]
    },
    'ברזל': {
      id: 'iron_drops',
      activeIngredient: 'iron',
      protocol: { version: 1, type: TREATMENT_TYPES.DAILY, dosesPerDay: 1 },
      matchNames: ['ברזל', 'ברזל לתינוקות', 'פריפר', 'גלוביפר'],
      concentrations: [
        { label: 'ממתין לנתוני מינון רשמיים', pendingLeaflet: true },
      ]
    },
    /* ── COURSE antibiotics (Step 2A) ────────────────────────────────────── */
    'מוקסיפן': {
      id: 'moxipen_susp',
      activeIngredient: 'amoxicillin',
      protocol: { version: 1, type: TREATMENT_TYPES.COURSE },
      matchNames: ['מוקסיפן'],
      concentrations: [],
    },
    'אמוקסיצילין': {
      id: 'amoxicillin_generic',
      activeIngredient: 'amoxicillin',
      protocol: { version: 1, type: TREATMENT_TYPES.COURSE },
      matchNames: ['אמוקסיצילין', 'אמוקסיציל'],
      concentrations: [],
    },
    'אוגמנטין': {
      id: 'augmentin_susp',
      activeIngredient: 'amoxicillin_clavulanate',
      protocol: { version: 1, type: TREATMENT_TYPES.COURSE },
      matchNames: ['אוגמנטין'],
      concentrations: [],
    },
  };
  /* resolves a free-text medicine name (as stored in medEntries / picked in the UI) to its catalog entry */
  function _catalogEntryFor(medicineName) {
    const key = Object.keys(MEDICATION_CATALOG).find((k) => _matchesDrug(medicineName, k));
    return key ? MEDICATION_CATALOG[key] : null;
  }
  /* resolves a stable product id (as stored on a Prescription) back to its display key + entry */
  function _catalogEntryById(productId) {
    const key = Object.keys(MEDICATION_CATALOG).find((k) => MEDICATION_CATALOG[k].id === productId);
    return key ? { key, ...MEDICATION_CATALOG[key] } : null;
  }

  /* ── COURSE helpers (Step 1B) ─────────────────────────────────────────────
     These operate purely on DB data + catalog — no UI side-effects.
     Safe to call from anywhere (dashboard render, reminder scheduler, etc.). */

  /* All active COURSE prescriptions for a child, newest first. */
  function _activeCourses(childId) {
    return DB.activePrescriptionsFor(childId).filter((p) => p.isCourse);
  }

  /* Ideal timestamp of the next dose for a COURSE prescription.
     Returns null if the course is completed/cancelled or has no doses configured.
     Logic: doses are evenly spread across each 24h day.
     e.g. dosesPerDay=2 → dose 0 at startAt, dose 1 at startAt+12h, dose 2 at startAt+24h, ...
     If a dose was already logged, next expected time is based on the last log entry + interval. */
  function _courseNextDoseAt(rx) {
    if (!rx || !rx.isCourse || rx.status !== 'active') return null;
    if (!rx.dosesPerDay || !rx.totalDays) return null;
    const intervalMs = (24 / rx.dosesPerDay) * 3600 * 1000;
    if (!rx.doseLog || rx.doseLog.length === 0) {
      // no doses given yet — first dose is due now (or at startAt, whichever is later)
      return Math.max(rx.startAt, Date.now());
    }
    const lastDoseAt = rx.doseLog[rx.doseLog.length - 1].at;
    return lastDoseAt + intervalMs;
  }

  /* How many doses were logged for this COURSE today (calendar day, 00:00–now).
     Kept for potential future use but no longer drives canMark logic. */
  function _dosesTodayCount(rx) {
    if (!rx || !rx.doseLog) return 0;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return rx.doseLog.filter((d) => d.at >= startOfDay.getTime()).length;
  }

  /* Returns true if enough time has passed since the last logged dose to allow marking a new one.
     Interval = 24h / dosesPerDay (e.g. 3x/day → 8h, 2x/day → 12h).
     Also returns true if no doses have been logged yet (first dose of the course). */
  function _canMarkDoseNow(rx) {
    if (!rx || !rx.isCourse) return false;
    const totalDoses = (rx.totalDays || 0) * (rx.dosesPerDay || 1);
    const dosesDone  = rx.doseLog ? rx.doseLog.length : 0;
    if (dosesDone >= totalDoses) return false;
    if (!dosesDone) return true; // first dose — always allowed
    const intervalMs = (24 / (rx.dosesPerDay || 1)) * 3600 * 1000;
    const lastDoseAt = rx.doseLog[dosesDone - 1].at;
    return Date.now() - lastDoseAt >= intervalMs;
  }

  /* Returns a human-readable string of how long until the next dose is allowed.
     Used in toast when user tries to mark too soon. */
  function _nextDoseInText(rx) {
    if (!rx || !rx.doseLog || !rx.doseLog.length) return '';
    const intervalMs = (24 / (rx.dosesPerDay || 1)) * 3600 * 1000;
    const lastDoseAt = rx.doseLog[rx.doseLog.length - 1].at;
    const remaining  = intervalMs - (Date.now() - lastDoseAt);
    if (remaining <= 0) return '';
    const hrs  = Math.floor(remaining / 3600000);
    const mins = Math.floor((remaining % 3600000) / 60000);
    if (hrs > 0) return `${hrs} שעות${mins > 0 ? ' ו-' + mins + ' דקות' : ''}`;
    return `${mins} דקות`;
  }

  /* True if the next dose is overdue by more than 30 minutes.
     Used to surface an alert badge on the dashboard card. */
  function _courseIsDoseOverdue(rx) {
    const nextAt = _courseNextDoseAt(rx);
    if (nextAt === null) return false;
    return Date.now() > nextAt + 30 * 60 * 1000;
  }

  /* Human-readable summary string for a COURSE (used in dashboard card subtitle).
     e.g. "יום 3 מתוך 10 · 4/20 מנות" */
  function _courseSummary(rx) {
    if (!rx || !rx.isCourse) return '';
    const dosesDone = rx.doseLog ? rx.doseLog.length : 0;
    const totalDoses = (rx.totalDays || 0) * (rx.dosesPerDay || 1);
    const daysSinceStart = Math.floor((Date.now() - rx.startAt) / (24 * 3600 * 1000)) + 1;
    const dayLabel = rx.totalDays ? `יום ${Math.min(daysSinceStart, rx.totalDays)} מתוך ${rx.totalDays}` : '';
    const doseLabel = totalDoses ? `${dosesDone}/${totalDoses} מנות` : '';
    return [dayLabel, doseLabel].filter(Boolean).join(' · ');
  }
  /* Aggregated, read-only snapshot for a child's active treatments — the "ViewModel" a future
     Active Treatments screen (and eventually the dashboard) will read from, instead of each piece
     of UI recomputing this itself. Built entirely on the 4 helpers above; does not touch DB, does
     not render, does not schedule anything.
     "next" = the course whose next dose is soonest among this child's active courses. */
  /* ── childStatusViewModel (שלב 1+2) ─────────────────────────────────────────
     מרכז את המידע הקיים לכדי snapshot קריא לכל ילד.
     לא מחשב לוגיקה רפואית חדשה — רק מאחד קריאות קיימות.
     at: timestamp מוחלט עתידי — null כשcanGive=true (זמין עכשיו). */
  function childStatusViewModel(childId) {
    const now = Date.now();

    /* חום */
    const lastTemp = DB.lastTempFor(childId);
    const hasFever = !!(lastTemp && lastTemp.value >= 38);

    /* תרופת PRN אחרונה */
    const lastMed = DB.lastMedFor(childId);
    let prnNextAt = null, canGivePRN = false, prnDrugName = null;
    // PRN נחשב פעיל רק אם lastMed אין לו prnDoneAt (כלומר לא לחצו "סיימתי")
    const prnActive = lastMed && !lastMed.prnDoneAt;
    if (prnActive) {
      const drugKey = Object.keys(MEDICATION_CATALOG).find(k => _matchesDrug(lastMed.medicine, k));
      const drug = drugKey ? MEDICATION_CATALOG[drugKey] : null;
      if (drug && drug.protocol.intervalHours) {
        const readyAt = lastMed.time + drug.protocol.intervalHours * 3600000;
        prnDrugName = lastMed.medicine;
        if (readyAt > now) { prnNextAt = readyAt; }
        else               { canGivePRN = true; }
      }
    }

    /* COURSE — משתמש ב-_activeTreatmentState הקיים בלבד */
    const courseState = _activeTreatmentState(childId);
    const courseAt = courseState.nextDoseAt;

    const _buildCourseEvent = () => {
      const entry = courseState.nextCourse ? _catalogEntryById(courseState.nextCourse.productId) : null;
      return { type: 'course', name: entry ? entry.key : '', at: courseAt,
               canGive: courseState.nextCourse ? _canMarkDoseNow(courseState.nextCourse) : false };
    };
    const _buildPrnEvent = () => ({ type: 'prn', name: prnDrugName, at: prnNextAt, canGive: canGivePRN });

    let nextEvent = null;
    if (canGivePRN) {
      nextEvent = _buildPrnEvent();
    } else if (prnNextAt !== null && courseAt !== null) {
      nextEvent = prnNextAt <= courseAt ? _buildPrnEvent() : _buildCourseEvent();
    } else if (prnNextAt !== null) {
      nextEvent = _buildPrnEvent();
    } else if (courseAt !== null) {
      nextEvent = _buildCourseEvent();
    }

    /* tags */
    const tags = [];
    if (hasFever)                    tags.push({ type: 'fever',     label: '🌡️ חום', value: lastTemp ? lastTemp.value : null });
    if (courseState.hasActiveCourse) tags.push({ type: 'treatment', label: '💊 טיפול' });
    if (prnActive && prnDrugName)    tags.push({ type: 'treatment', label: '💊 טיפול' });

    /* ימים בריא — מאז הפעם האחרונה שהייתה תרופה או חום ≥38 */
    let healthyDays = null;
    const state = DB.get();
    const allMeds  = state.medEntries.filter(e => e.childId === childId && !e.isSupp);
    const allTemps = state.tempEntries.filter(e => e.childId === childId && e.value >= 38);
    const lastSickEvent = [...allMeds, ...allTemps]
      .map(e => e.time)
      .sort((a, b) => b - a)[0] || null;
    if (!hasFever && !courseState.hasActiveCourse) {
      if (lastSickEvent) {
        healthyDays = Math.floor((now - lastSickEvent) / (24 * 3600 * 1000));
      } else {
        // אף פעם לא חלה — מציגים ימים מאז יצירת הפרופיל
        const child = DB.get().children.find(c => c.id === childId);
        const since = child && (child.createdAt || (child.birthDate ? new Date(child.birthDate).getTime() : null));
        healthyDays = since ? Math.floor((now - since) / (24 * 3600 * 1000)) : 0;
      }
    }

    return { hasFever, lastTemp, lastMed, prnActive, canGivePRN, nextEvent, courseState, tags, healthyDays };
  }
  /* ── end childStatusViewModel ──────────────────────────────────────── */

  function _activeTreatmentState(childId) {
    const activeCourses = _activeCourses(childId);
    let nextCourse = null, nextDoseAt = null, overdueCount = 0;
    activeCourses.forEach((rx) => {
      if (_courseIsDoseOverdue(rx)) overdueCount++;
      const at = _courseNextDoseAt(rx);
      if (at != null && (nextDoseAt === null || at < nextDoseAt)) {
        nextDoseAt = at;
        nextCourse = rx;
      }
    });
    return {
      hasActiveCourse: activeCourses.length > 0,
      activeCourses,
      overdueCount,
      nextDoseAt,
      nextCourse,
      summary: nextCourse ? _courseSummary(nextCourse) : '',
    };
  }
  /* ── end COURSE helpers ───────────────────────────────────────────────── */

  /* Step 1E (updated Step 3B) — Active Treatments dashboard card.
     Shows only ACTIVE COURSE prescriptions. Completed ones are hidden here — they appear in History.
     Active courses: "פעיל" badge + "סימון מנה" button (when daily limit not reached) + delete button. */
  function _renderActiveTreatmentsCard(children) {
    const wrap = document.getElementById('dash-active-treatments');
    const dbState = DB.get();
    const rows = [];
    children.forEach((c) => {
      const activeCourses = dbState.prescriptions.filter(
        (p) => p.childId === c.id && p.isCourse && p.status === 'active'
      );
      if (!activeCourses.length) return;
      activeCourses.forEach((rx) => {
        const entry = _catalogEntryById(rx.productId);
        const drugName = entry ? entry.key : 'טיפול פעיל';
        const cardTitle = rx.reason ? `${c.name} — ${rx.reason}` : `${c.name} · ${drugName}`;
        const drugSubline = rx.reason ? `<div style="font-size:13px;color:var(--ink-soft);">${drugName}</div>` : '';
        const border = rows.length ? 'border-top:1px solid var(--line);' : '';
        const totalDoses = (rx.totalDays || 0) * (rx.dosesPerDay || 1);
        const dosesDone = rx.doseLog ? rx.doseLog.length : 0;
        const summary = _courseSummary(rx);
        const canMark = _canMarkDoseNow(rx);
        const nextAt  = _courseNextDoseAt(rx);
        let timerText = '';
        if (canMark) {
          timerText = '🟢 זמין עכשיו';
        } else if (nextAt) {
          const remaining = nextAt - Date.now();
          if (remaining > 0) {
            const hrs  = Math.floor(remaining / 3600000);
            const mins = Math.floor((remaining % 3600000) / 60000);
            timerText = hrs > 0
              ? `⏱ מנה הבאה בעוד ${hrs} שעות${mins > 0 ? ' ו-' + mins + ' דקות' : ''}`
              : `⏱ מנה הבאה בעוד ${mins} דקות`;
          }
        }
        const markBtn = canMark
          ? `<button onclick="App.markCourseDose('${rx.id}')" style="padding:5px 12px;border-radius:8px;border:none;background:var(--accent,#4a90d9);color:#fff;font-size:13px;cursor:pointer;">✓ סימון מנה</button>`
          : `<button onclick="App.markCourseDose('${rx.id}')" style="padding:5px 12px;border-radius:8px;border:none;background:#ccc;color:#888;font-size:13px;cursor:not-allowed;" disabled>✓ סימון מנה</button>`;
        const deleteBtn = `<button onclick="App.deleteCourse('${rx.id}')" style="padding:5px 10px;border-radius:8px;border:none;background:transparent;color:var(--coral,#e57373);font-size:13px;cursor:pointer;">🗑 מחיקה</button>`;
        const editBtn   = `<button onclick="App.openCourseSheet('${rx.id}')" style="padding:5px 10px;border-radius:8px;border:none;background:transparent;color:var(--ink-soft);font-size:13px;cursor:pointer;">✏️ עריכה</button>`;
        rows.push(`
          <div style="padding:9px 0;${border}">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
              <div>
                <div style="font-weight:600;">${cardTitle}</div>
                ${drugSubline}
                <div style="font-size:13px;color:var(--ink-soft);">${summary}</div>
                ${timerText ? `<div style="font-size:12px;color:var(--ink-soft);margin-top:2px;">${timerText}</div>` : ''}
              </div>
              <span style="color:var(--mint);white-space:nowrap;">🟢 פעיל</span>
            </div>
            <div style="display:flex;gap:8px;margin-top:6px;">${markBtn}${editBtn}${deleteBtn}</div>
          </div>`);
      });
    });
    if (!rows.length) { wrap.style.display = 'none'; wrap.innerHTML = ''; return; }
    wrap.style.display = '';
    wrap.innerHTML = `<div class="info-card"><div style="font-weight:700;margin-bottom:2px;">💊 טיפולים פעילים</div>${rows.join('')}</div>`;
  }

  /* Step 3A — mark a single dose as given for a COURSE prescription.
     Edge cases handled here (not in db.js):
     - rxId not found → null returned from DB → toast + bail
     - course already completed before this call → bail with message
     - doses would exceed totalDays*dosesPerDay → DB auto-completes; we show completion toast */
  /* "סיימתי" — PRN: מסמן את המנה האחרונה כ-done, ללא מחיקה */
  function doneWithPRN(childId) {
    const lastMed = DB.lastMedFor(childId);
    if (!lastMed) return;
    DB.updateMedEntry(lastMed.id, { prnDoneAt: Date.now() });
    toast('התרופה סומנה כסיימתי ✓');
    _renderSelectedChildPanel();
    renderDashboard();
  }

  /* "סיימתי" — Course: משנה סטטוס ל-completed */
  function doneWithCourse(rxId) {
    DB.updatePrescription(rxId, { status: 'completed', endAt: Date.now() });
    toast('הטיפול הסתיים ✓');
    _renderSelectedChildPanel();
    renderDashboard();
  }

  async function markCourseDose(rxId) {
    const dbState = DB.get();
    const rx = dbState.prescriptions.find((p) => p.id === rxId);
    if (!rx) { toast('שגיאה: הטיפול לא נמצא'); return; }
    if (rx.status === 'completed') { toast('הטיפול כבר הסתיים'); return; }
    const totalDoses = (rx.totalDays || 0) * (rx.dosesPerDay || 1);
    const doneBeforeLog = rx.doseLog ? rx.doseLog.length : 0;
    if (totalDoses > 0 && doneBeforeLog >= totalDoses) { toast('כל המנות כבר סומנו'); return; }
    if (!_canMarkDoseNow(rx)) {
      const waitText = _nextDoseInText(rx);
      toast(waitText ? `המנה הבאה בעוד ${waitText}` : 'עוד לא הגיע הזמן למנה הבאה');
      return;
    }
    const updated = DB.logCourseDose(rxId, 1);
    if (!updated) { toast('שגיאה בשמירה — נסה שוב'); return; }
    if (updated.status === 'completed') {
      await _cancelCourseReminder(updated); // no more doses — cancel any pending push
      toast('🎉 הטיפול הושלם בהצלחה!');
    } else {
      const done = updated.doseLog.length;
      toast(`✓ מנה ${done} מתוך ${totalDoses} סומנה`);
      _scheduleCourseReminder(updated); // best-effort, not awaited — don't block UI
    }
    renderDashboard();
  }

  let doseMedSel = 'אקמול / נובימול';
  let doseConcIdx = 0;
  let doseChildId = null;

  /* Step 3B — manually delete an active COURSE prescription (with confirm). */
  async function deleteCourse(rxId) {
    const dbState = DB.get();
    const rx = dbState.prescriptions.find((p) => p.id === rxId);
    if (!rx) { toast('הטיפול לא נמצא'); return; }
    const entry = _catalogEntryById(rx.productId);
    const drugName = entry ? entry.key : 'טיפול';
    if (!confirm(`למחוק את הטיפול ב${drugName}? הפעולה לא ניתנת לביטול.`)) return;
    await _cancelCourseReminder(rx);
    DB.deletePrescription(rxId);
    renderDashboard();
    toast('הטיפול נמחק');
  }
  let courseChildId = null;
  let courseDrugSel = null; // key in MEDICATION_CATALOG
  let editCourseRxId = null; // null = new course, rxId = edit mode

  function openCourseSheet(rxId = null) {
    const state = DB.get();
    editCourseRxId = rxId || null;

    if (editCourseRxId) {
      // edit mode — load existing prescription values
      const rx = state.prescriptions.find((p) => p.id === editCourseRxId);
      if (!rx) { toast('הטיפול לא נמצא'); return; }
      courseChildId = rx.childId;
      const entry = _catalogEntryById(rx.productId);
      courseDrugSel = entry ? entry.key : null;
      document.getElementById('course-days').value = rx.totalDays || '';
      document.getElementById('course-doses-per-day').value = rx.dosesPerDay || '';
      document.getElementById('course-reason').value = rx.reason || '';
      document.getElementById('sheet-course-title').textContent = '✏️ עריכת טיפול';
    } else {
      // new course
      courseChildId = state.children[0]?.id || null;
      const firstCourseKey = Object.keys(MEDICATION_CATALOG).find(
        (k) => MEDICATION_CATALOG[k].protocol.type === TREATMENT_TYPES.COURSE
      );
      courseDrugSel = firstCourseKey || null;
      document.getElementById('course-days').value = '';
      document.getElementById('course-doses-per-day').value = '';
      document.getElementById('course-reason').value = '';
      document.getElementById('sheet-course-title').textContent = '💊 פתיחת טיפול';
    }

    _renderCourseChildChips();
    _renderCourseDrugChips();
    openSheet('sheet-course');
  }

  function _renderCourseChildChips() {
    const state = DB.get();
    const box = document.getElementById('course-child-chips');
    if (!box) return;
    if (editCourseRxId) {
      // edit mode — show selected child as read-only
      const c = state.children.find((ch) => ch.id === courseChildId);
      box.innerHTML = c ? `<span class="chip sel" style="opacity:.7;">${c.emoji} ${c.name}</span>` : '';
      return;
    }
    box.innerHTML = state.children.map((c) =>
      `<button type="button" class="chip ${c.id === courseChildId ? 'sel' : ''}" onclick="App.pickCourseChild('${c.id}')">${c.emoji} ${c.name}</button>`
    ).join('');
  }

  function _renderCourseDrugChips() {
    const box = document.getElementById('course-drug-chips');
    if (!box) return;
    if (editCourseRxId) {
      // edit mode — show selected drug as read-only
      box.innerHTML = courseDrugSel ? `<span class="chip sel" style="opacity:.7;">${courseDrugSel}</span>` : '';
      return;
    }
    const courseKeys = Object.keys(MEDICATION_CATALOG).filter(
      (k) => MEDICATION_CATALOG[k].protocol.type === TREATMENT_TYPES.COURSE
    );
    box.innerHTML = courseKeys.map((k) =>
      `<button type="button" class="chip ${k === courseDrugSel ? 'sel' : ''}" onclick="App.pickCourseDrug('${k}')">${k}</button>`
    ).join('');
  }

  function pickCourseChild(id) {
    courseChildId = id;
    _renderCourseChildChips();
  }

  function pickCourseDrug(key) {
    courseDrugSel = key;
    _renderCourseDrugChips();
  }

  function saveCourse() {
    if (!courseChildId) { toast('יש לבחור ילד/ה'); return; }
    if (!courseDrugSel) { toast('יש לבחור תרופה'); return; }
    const totalDays = parseInt(document.getElementById('course-days').value, 10);
    const dosesPerDay = parseInt(document.getElementById('course-doses-per-day').value, 10);
    if (!totalDays || totalDays < 1 || totalDays > 30) { toast('יש להזין מספר ימים (1–30)'); return; }
    if (!dosesPerDay || dosesPerDay < 1 || dosesPerDay > 6) { toast('יש להזין מספר מנות ביום (1–6)'); return; }
    const reason = (document.getElementById('course-reason').value || '').trim();
    if (!reason) { toast('יש להזין סיבת הטיפול'); return; }

    if (editCourseRxId) {
      // edit mode — update totalDays, dosesPerDay, reason
      const updated = DB.updatePrescription(editCourseRxId, { totalDays, dosesPerDay, reason });
      if (!updated) { toast('שגיאה בשמירה — נסה שוב'); return; }
      // reschedule push with new interval
      _cancelCourseReminder(updated).then(() => _scheduleCourseReminder(
        DB.get().prescriptions.find((p) => p.id === editCourseRxId)
      ));
      closeSheet('sheet-course');
      renderDashboard();
      toast('הטיפול עודכן ✓');
      editCourseRxId = null;
      return;
    }

    // new course
    const drug = MEDICATION_CATALOG[courseDrugSel];
    try {
      DB.addPrescription({
        childId: courseChildId,
        productId: drug.id,
        isCourse: true,
        totalDays,
        dosesPerDay,
        reason,
      });
      closeSheet('sheet-course');
      renderDashboard();
      toast('הטיפול נפתח בהצלחה ✓');
    } catch (e) {
      toast('שגיאה בשמירה — נסה שוב');
    }
  }
  /* ── end sheet-course (Step 2A) ─────────────────────────────────────────── */

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
    document.getElementById('dose-med-chips').innerHTML = Object.keys(MEDICATION_CATALOG).map((m) =>
      `<button type="button" class="chip ${m === doseMedSel ? 'sel' : ''}" onclick="App.pickDoseMed('${m}')">${m}</button>`
    ).join('');
  }

  function _renderDoseConcChips() {
    const concs = MEDICATION_CATALOG[doseMedSel].concentrations;
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

  /* does a free-text medicine name (as stored in medEntries) belong to this MEDICATION_CATALOG drug? */
  function _matchesDrug(medicineName, drugKey) {
    if (!medicineName) return false;
    const names = MEDICATION_CATALOG[drugKey].matchNames || [];
    return names.some((n) => medicineName.indexOf(n) !== -1);
  }
  /* all brand keys (MEDICATION_CATALOG entries) that share a given active ingredient — e.g. paracetamol -> ['נובימול','אקמול'] */
  function _brandKeysForIngredient(ingredientKey) {
    return Object.keys(MEDICATION_CATALOG).filter((k) => MEDICATION_CATALOG[k].activeIngredient === ingredientKey);
  }
  /* true if medicineName matches ANY brand sharing this active ingredient — this is what lets the app
     see Acamol + Novimol as "the same substance" for safety checks, instead of two unrelated drugs */
  function _matchesIngredient(medicineName, ingredientKey) {
    return _brandKeysForIngredient(ingredientKey).some((k) => _matchesDrug(medicineName, k));
  }

  function _doseHistoryWarning(childId, drugKey) {
    if (!childId) return null;
    const drug = MEDICATION_CATALOG[drugKey];
    const ingredientKey = drug.activeIngredient;
    const ingredient = ingredientKey ? ACTIVE_INGREDIENTS[ingredientKey] : null;
    const now = Date.now();
    // match on the active ingredient (across brands) when we know it — otherwise fall back to this brand only
    const entries = ingredientKey
      ? DB.get().medEntries.filter((e) => e.childId === childId && _matchesIngredient(e.medicine, ingredientKey))
      : DB.get().medEntries.filter((e) => e.childId === childId && _matchesDrug(e.medicine, drugKey));
    if (!entries.length) return null;

    const last = entries.reduce((a, b) => (b.time > a.time ? b : a));

    if (drug.protocol.type === TREATMENT_TYPES.DAILY) {
      // once-a-day meds: warn if one was already given today (calendar day), not by hour-interval
      const sameDay = new Date(last.time).toDateString() === new Date(now).toDateString();
      if (sameDay) {
        return { level: 'alert', text: `☀️ ${ingredient ? ingredient.name : drugKey} כבר ניתן/ה היום ב-${formatClock(last.time)} — זו תרופה שניתנת פעם אחת ביום.` };
      }
      return null;
    }

    if (drug.protocol.intervalHours != null) {
      const hoursSince = (now - last.time) / 3600000;
      if (hoursSince < drug.protocol.intervalHours) {
        const remain = Math.ceil(drug.protocol.intervalHours - hoursSince);
        const otherBrand = ingredient && !_matchesDrug(last.medicine, drugKey) ? ` (${ingredient.name}, ניתן בתור "${last.medicine}")` : '';
        return { level: 'alert', text: `⏱️ המנה האחרונה${otherBrand} הייתה לפני ${hoursSince < 1 ? 'פחות משעה' : Math.floor(hoursSince) + ' שעות'} — המרווח המומלץ הוא ${drug.protocol.interval}. מומלץ להמתין כ־${remain} שעות נוספות לפני מנה נוספת.` };
      }
    }

    if (drug.protocol.maxDosesPerDay != null) {
      const last24h = entries.filter((e) => now - e.time <= 24 * 3600000).length;
      if (last24h >= drug.protocol.maxDosesPerDay) {
        const substanceNote = ingredient ? `מ${ingredient.name} (כולל מותגים אחרים עם אותו חומר פעיל)` : 'מהתרופה הזו';
        return { level: 'alert', text: `⚠️ כבר ניתנו ${last24h} מנות ${substanceNote} ב־24 השעות האחרונות — זהו המספר המרבי המומלץ ליום. אין לתת מנה נוספת בלי להתייעץ עם רופא/ה או רוקח/ת.` };
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

    const drug = MEDICATION_CATALOG[doseMedSel];
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
    if (drug.protocol.interval) subParts.push(`כל ${drug.protocol.interval}`);
    if (drug.protocol.maxDosesPerDay != null) subParts.push(`עד ${drug.protocol.maxDosesPerDay} מנות ב-24 שעות`);
    box.style.display = 'block';
    box.innerHTML = `
      <div class="dose-result-title">המינון לפי טבלת היצרן</div>
      <div class="dose-result-ml">${row.ml.toFixed(2)} מ"ל</div>
      <div class="dose-result-sub">${subParts.length ? subParts.join(' · ') : 'יש לבדוק מרווח ומספר מנות מרבי בעלון'}</div>
      <div class="dose-result-detail">${mg != null ? mg + ' מ"ג ' : ''}לילד/ה במשקל ${weightLabel} (טבלת עלון היצרן)</div>
    `;

    const warning = _doseHistoryWarning(doseChildId, doseMedSel);
    if (warning && warnBox) {
      warnBox.style.display = 'block';
      warnBox.className = 'dose-warning dose-warning-' + warning.level;
      warnBox.innerHTML = warning.text;
    }
  }

  /* ---------- auth UI ---------- */

  /* Switch between Login / Signup tabs in screen-auth */
  function authTab(which) {
    document.getElementById('auth-panel-login').style.display  = which === 'login'  ? '' : 'none';
    document.getElementById('auth-panel-signup').style.display = which === 'signup' ? '' : 'none';
    document.getElementById('auth-tab-login').classList.toggle('active',  which === 'login');
    document.getElementById('auth-tab-signup').classList.toggle('active', which === 'signup');
    _authClearError();
  }

  function _authShowError(msg) {
    const el = document.getElementById('auth-error');
    el.textContent = msg;
    el.style.display = '';
  }
  function _authClearError() {
    const el = document.getElementById('auth-error');
    if (el) el.style.display = 'none';
  }

  /* Translate Firebase error codes to Hebrew */
  function _authErrorMsg(code) {
    const map = {
      'auth/email-already-in-use':    'כתובת האימייל כבר רשומה במערכת',
      'auth/invalid-email':           'כתובת אימייל לא תקינה',
      'auth/weak-password':           'הסיסמה חייבת להכיל לפחות 6 תווים',
      'auth/user-not-found':          'לא נמצא משתמש עם אימייל זה',
      'auth/wrong-password':          'סיסמה שגויה',
      'auth/too-many-requests':       'יותר מדי ניסיונות — נסה שוב עוד מספר דקות',
      'auth/network-request-failed':  'בעיית חיבור — בדוק אינטרנט ונסה שוב',
    };
    return map[code] || 'שגיאה — נסה שוב';
  }

  async function authLogin() {
    _authClearError();
    const email    = document.getElementById('auth-login-email').value.trim();
    const password = document.getElementById('auth-login-password').value;
    if (!email || !password) { _authShowError('יש למלא אימייל וסיסמה'); return; }
    try {
      const { familyId } = await Auth.login(email, password);
      _afterAuthSuccess(email, familyId);
    } catch (e) {
      _authShowError(_authErrorMsg(e.code));
    }
  }

  async function authSignup() {
    _authClearError();
    const email    = document.getElementById('auth-signup-email').value.trim();
    const password = document.getElementById('auth-signup-password').value;
    if (!email || !password) { _authShowError('יש למלא אימייל וסיסמה'); return; }
    try {
      const { familyId } = await Auth.signup(email, password);
      _afterAuthSuccess(email, familyId);
    } catch (e) {
      _authShowError(_authErrorMsg(e.code));
    }
  }

  async function authLogout() {
    const sure = confirm('להתנתק מהחשבון?');
    if (!sure) return;
    await Auth.logout();
    // onAuthStateChanged will fire and route to screen-auth
  }

  /* Called after successful login or signup */
  function _afterAuthSuccess(email, familyId) {
    _renderAccountInfo(email, familyId);
    // Continue normal app flow — same as before Auth
    const isReturningUser = DB.get().children.length > 0;
    if (isReturningUser) {
      goto('screen-dash');
    } else {
      startOnboarding();
    }
  }

  /* Update the account rows in Settings */
  function _renderAccountInfo(email, familyId) {
    const emailEl    = document.getElementById('set-account-email');
    const familyEl   = document.getElementById('set-family-id');
    if (emailEl)  emailEl.textContent  = email    || '—';
    if (familyEl) familyEl.textContent = familyId || '—';
  }

  /* ---------- settings ---------- */
  function renderSettings() {
    const on = DB.get().settings.notifications;
    document.getElementById('toggle-notif').classList.toggle('on', on);
    document.getElementById('set-version-num').textContent = APP_VERSION;
    const aboutV = document.getElementById('about-version-num');
    if (aboutV) aboutV.textContent = APP_VERSION;
    // refresh account info if user already signed in
    const user = Auth.currentUser();
    if (user) {
      // familyId is not cached in memory — show email for now; familyId populated at login/signup
      const emailEl = document.getElementById('set-account-email');
      if (emailEl && emailEl.textContent === '—') emailEl.textContent = user.email || '—';
    }
  }
  /* generic handler for features that are planned but not built yet — keeps buttons
     visibly "alive" instead of dead, per Step 1.3 (no silent no-op buttons in Settings) */
  function stub() {
    toast('🚧 הפיצ׳ר יתווסף בגרסה עתידית');
  }
  function toggleNotif() {
    const on = !DB.get().settings.notifications;

    // עדכן UI מיד — לפני כל async
    try {
      DB.setSetting('notifications', on);
    } catch (e) {
      toast('⚠️ השמירה נכשלה — בדקו מקום פנוי במכשיר ונסו שוב');
      return;
    }
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

      const doReload = () => {
        toast('נמצא עדכון — טוען מחדש…');
        setTimeout(() => window.location.reload(), 600);
      };

      // listen for controller swap (fires when new SW takes over)
      navigator.serviceWorker.addEventListener('controllerchange', doReload, { once: true });

      reg.update().then(() => {
        // iOS fix: after update(), check if a SW is already waiting
        // (controllerchange may not fire on its own on iOS)
        if (reg.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          return; // doReload fires via controllerchange
        }
        // watch for a new SW installing then waiting
        const onUpdateFound = () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && reg.waiting) {
              reg.waiting.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        };
        reg.addEventListener('updatefound', onUpdateFound, { once: true });
        // fallback timeout — no update found
        setTimeout(() => {
          reg.removeEventListener('updatefound', onUpdateFound);
          navigator.serviceWorker.removeEventListener('controllerchange', doReload);
          toast(`אתה כבר בגרסה העדכנית (${APP_VERSION}) ✓`);
        }, 5000);
      }).catch(() => {
        navigator.serviceWorker.removeEventListener('controllerchange', doReload);
        toast('לא הצלחנו לבדוק עדכונים — בדוק חיבור');
      });
    });
  }

  /* ---------- danger zone ---------- */
  function confirmReset() {
    const sure = confirm('לאפס את כל הנתונים? כל הילדים, התרופות והמדידות יימחקו לצמיתות. הפעולה אינה הפיכה.');
    if (!sure) return;
    const reallySure = confirm('בטוח/ה לגמרי? זו הזדמנות אחרונה לבטל.');
    if (!reallySure) return;
    try {
      DB.reset();
    } catch (e) {
      toast('⚠️ האיפוס נכשל — נסו שוב');
      return;
    }
    toast('כל הנתונים אופסו');
    renderLanding();
    renderDashboard();
    renderHistory();
    renderTemp();
    renderSettings();
    renderKids();
    goto('screen-kids');
  }

  /* On app open: ensure every active supplement prescription either has a future push scheduled,
     or gets one. Also auto-completes prescriptions where the child has aged out. */
  function _healSupplementReminders() {
    const notifOn = DB.get().settings.notifications;
    console.log('[Supp] _healSupplementReminders — notifications:', notifOn);
    if (!notifOn) return;
    const now = Date.now();
    const supplementIds = ['vitamin_d_drops', 'iron_drops'];
    const rxList = DB.get().prescriptions.filter((p) => supplementIds.includes(p.productId) && p.status === 'active');
    console.log('[Supp] active supplement prescriptions:', rxList.length, rxList.map(r => ({ id: r.id, product: r.productId, reminder: r.reminder, reminderAt: r.supplementReminderAt })));
    rxList.forEach((rx) => {
      const alreadyScheduled = rx.supplementReminderAt && rx.supplementReminderAt > now;
      console.log('[Supp] rx', rx.productId, '— alreadyScheduled:', alreadyScheduled, '| reminderAt:', rx.supplementReminderAt ? new Date(rx.supplementReminderAt).toLocaleTimeString('he-IL') : 'none');
      if (!alreadyScheduled) scheduleSupplementReminder(rx);
    });
  }

  /* ══════════════════════════════════════════════════════════
     ONBOARDING — new-user flow (screen-onboarding)
     Steps: 1=parent  2=avatar+name  3=birth+weight  →popup
  ══════════════════════════════════════════════════════════ */
  function _obShowStep(n) {
    [1, 2, 3].forEach((i) => {
      const el = document.getElementById('ob-step-' + i);
      if (el) el.style.display = i === n ? 'flex' : 'none';
    });
  }

  function obPickParent(type) {
    _obParent = type;
    document.getElementById('ob-dad').classList.toggle('ob-sel', type === 'dad');
    document.getElementById('ob-mom').classList.toggle('ob-sel', type === 'mom');
  }

  function obPickAv(el) {
    document.querySelectorAll('.ob-av').forEach((a) => a.classList.remove('ob-av-sel'));
    el.classList.add('ob-av-sel');
    _obAvatar = el.dataset.av;
    _obPhoto  = null; // avatar overrides photo
    const txt = document.getElementById('ob-photo-txt');
    if (txt) txt.textContent = 'העלו תמונת פרופיל';
    // remove any preview img
    const prev = document.getElementById('ob-photo-preview-img');
    if (prev) prev.remove();
  }

  function obHandlePhoto(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      _obPhoto = e.target.result;
      // show preview
      let prev = document.getElementById('ob-photo-preview-img');
      if (!prev) {
        prev = document.createElement('img');
        prev.id = 'ob-photo-preview-img';
        prev.className = 'ob-photo-preview';
        document.querySelector('.ob-photo-btn').appendChild(prev);
      }
      prev.src = _obPhoto;
      const txt = document.getElementById('ob-photo-txt');
      if (txt) txt.textContent = 'תמונה נבחרה ✓';
      // deselect avatar chips
      document.querySelectorAll('.ob-av').forEach((a) => a.classList.remove('ob-av-sel'));
    };
    reader.readAsDataURL(file);
  }

  function obValidate2() {
    const name = (document.getElementById('ob-kid-name')?.value || '').trim();
    const btn  = document.getElementById('ob-next-2');
    if (btn) btn.disabled = !name;
  }

  function obBirthChange() {
    const val  = document.getElementById('ob-birth')?.value;
    const chip = document.getElementById('ob-age-chip');
    const txt  = document.getElementById('ob-age-txt');
    if (val && chip && txt) {
      const months = calcAgeMonths(val);
      if (months !== null && months >= 0) {
        const yrs = Math.floor(months / 12);
        const rem = months % 12;
        let label = '';
        if (yrs === 0)       label = `${rem} חודשים`;
        else if (rem === 0)  label = `${yrs} ${yrs === 1 ? 'שנה' : 'שנים'}`;
        else                 label = `${yrs} ${yrs === 1 ? 'שנה' : 'שנים'} ו-${rem} חודשים`;
        txt.textContent = `גיל מחושב: ${label}`;
        chip.style.display = 'flex';
      } else {
        chip.style.display = 'none';
      }
    } else if (chip) {
      chip.style.display = 'none';
    }
    obValidate3();
  }

  function obValidate3() {
    const w   = parseFloat(document.getElementById('ob-weight')?.value);
    const btn = document.getElementById('ob-next-3');
    if (btn) btn.disabled = isNaN(w) || w <= 0;
  }

  function obNext(fromStep) {
    if (fromStep === 1) {
      _obShowStep(2);
      return;
    }
    if (fromStep === 2) {
      const name = (document.getElementById('ob-kid-name')?.value || '').trim();
      if (!name) { toast('נא להזין שם'); return; }
      _obShowStep(3);
      return;
    }
    if (fromStep === 3) {
      _obFinish();
    }
  }

  function obBack(fromStep) {
    if (fromStep === 2) {
      // if parent step was skipped (returning user), go back to origin screen
      if (DB.get().children.length > 0) { goto(_obReturnTo); return; }
      _obShowStep(1);
    }
    if (fromStep === 3) _obShowStep(2);
  }

  function _obFinish() {
    const name      = (document.getElementById('ob-kid-name')?.value || '').trim();
    const birthVal  = document.getElementById('ob-birth')?.value || null;
    const weightRaw = parseFloat(document.getElementById('ob-weight')?.value);
    const weight    = isNaN(weightRaw) ? 0 : weightRaw;

    // Determine avatar — photo upload not stored (localStorage size limit)
    const emoji = _obAvatar;

    // Build child object
    const childData = {
      name,
      weight,
      birthDate: birthVal || null,
      birthYear: birthVal ? parseInt(birthVal.slice(0, 4), 10) : null,
      emoji,
      parentType: _obParent,
    };

    try {
      DB.addChild(childData);
    } catch (e) {
      toast('⚠️ שגיאה בשמירה — בדקו מקום פנוי');
      return;
    }

    // Check supplement eligibility
    const ageMonths = calcAgeMonths(birthVal);
    const needVitD  = ageMonths === null || ageMonths < 12;
    const needIron  = ageMonths === null || (ageMonths >= 4 && ageMonths < 18);

    if (needVitD || needIron) {
      _obShowSupplPopup(name, ageMonths, needVitD, needIron);
    } else {
      _obComplete();
    }
  }

  function _obShowSupplPopup(name, ageMonths, needVitD, needIron) {
    const overlay = document.getElementById('ob-suppl-overlay');
    const title   = document.getElementById('ob-suppl-title');
    const body    = document.getElementById('ob-suppl-body');
    const cards   = document.getElementById('ob-suppl-cards');
    if (!overlay) return;

    title.textContent = `תוספים יומיים ל${name}`;

    const ageLabel = ageMonths !== null
      ? `גיל ${ageMonths < 12 ? ageMonths + ' חודשים' : Math.floor(ageMonths / 12) + ' שנים ו-' + (ageMonths % 12) + ' חודשים'}`
      : 'הגיל שהוזן';

    body.textContent = `לפי המלצת משרד הבריאות, ילדים בגיל זה (${ageLabel}) זקוקים לתוספים יומיים. רוצים שנזכיר לכם כל יום?`;

    let cardsHTML = '';
    if (needVitD) {
      cardsHTML += `<div class="ob-suppl-card">
        <div class="ob-suppl-card-ic">☀️</div>
        <div class="ob-suppl-card-name">ויטמין D</div>
        <div class="ob-suppl-card-age">מלידה עד גיל 12 חודש</div>
      </div>`;
    }
    if (needIron) {
      cardsHTML += `<div class="ob-suppl-card">
        <div class="ob-suppl-card-ic">🩸</div>
        <div class="ob-suppl-card-name">ברזל</div>
        <div class="ob-suppl-card-age">מגיל 4 עד 18 חודש</div>
      </div>`;
    }
    cards.innerHTML = cardsHTML;
    overlay.style.display = 'flex';
  }

  function obActivateSupplements() {
    const state    = DB.get();
    const child    = state.children[state.children.length - 1];
    if (!child) return;
    _saveSupplementPrescriptions(child.id);
    document.getElementById('ob-suppl-overlay').style.display = 'none';
    _obComplete();
  }

  function obSkipSupplements() {
    document.getElementById('ob-suppl-overlay').style.display = 'none';
    _obComplete();
  }

  let _obReturnTo = 'screen-dash'; // where to go after onboarding completes

  function _obComplete() {
    renderDashboard();
    renderKids();
    toast('נשמר בהצלחה ✓');
    goto(_obReturnTo);
  }

  function startOnboarding(returnTo) {
    _obReturnTo = returnTo || 'screen-dash';
    // Show back button only when coming from settings (not first launch)
    const backBtn = document.getElementById('ob-step1-back');
    if (backBtn) backBtn.style.display = returnTo && returnTo !== 'screen-dash' ? 'block' : 'none';
    // If parent already exists (returning user adding another child) — skip step 1
    const existingChildren = DB.get().children;
    const skipParentStep = existingChildren.length > 0;
    if (skipParentStep) {
      // inherit parent type from first child
      const firstKid = existingChildren[0];
      if (firstKid && firstKid.parentType) _obParent = firstKid.parentType;
    }
    // Reset state
    _obParent = 'dad';
    _obAvatar = '🧒';
    _obPhoto  = null;
    // Reset UI
    const dad = document.getElementById('ob-dad');
    const mom = document.getElementById('ob-mom');
    if (dad) { dad.classList.add('ob-sel'); }
    if (mom) { mom.classList.remove('ob-sel'); }
    document.querySelectorAll('.ob-av').forEach((a) => a.classList.remove('ob-av-sel'));
    const firstAv = document.querySelector('.ob-av');
    if (firstAv) firstAv.classList.add('ob-av-sel');
    const nameEl = document.getElementById('ob-kid-name');
    if (nameEl) nameEl.value = '';
    const birthEl = document.getElementById('ob-birth');
    if (birthEl) birthEl.value = '';
    const weightEl = document.getElementById('ob-weight');
    if (weightEl) weightEl.value = '';
    const chip = document.getElementById('ob-age-chip');
    if (chip) chip.style.display = 'none';
    const overlay = document.getElementById('ob-suppl-overlay');
    if (overlay) overlay.style.display = 'none';
    const n2 = document.getElementById('ob-next-2');
    if (n2) n2.disabled = true;
    const n3 = document.getElementById('ob-next-3');
    if (n3) n3.disabled = true;
    _obShowStep(skipParentStep ? 2 : 1);
    goto('screen-onboarding');
  }

  function init() {
    // Render all screens so they're ready before any transition
    renderLanding();
    renderDashboard();
    renderSettings();
    setInterval(renderDashboard, 60000); // keep "elapsed" times fresh
    setTimeout(_healSupplementReminders, 2000); // heal supplement pushes after app settles

    // ── Auth-first routing ────────────────────────────────────────────────
    // onAuthStateChanged fires once on load (user|null), then on every change.
    // Guard prevents double-routing (Firebase fires twice: cached + server-verified).
    let _authRouted = false;
    Auth.onAuthReady((user) => {
      console.log('[Auth] onAuthStateChanged →', user ? `uid=${user.uid}` : 'null', '| routed=', _authRouted);
      if (!user) {
        _authRouted = false; // reset so re-login works
        if (splashAnimId) { cancelAnimationFrame(splashAnimId); splashAnimId = null; }
        goto('screen-auth');
        return;
      }
      // Signed in — update Settings with email; familyId resolved later
      _renderAccountInfo(user.email, null);
      if (window.firebase && firebase.apps.length) {
        try {
          firebase.firestore().doc(`users/${user.uid}`).get().then((snap) => {
            if (snap.exists) _renderAccountInfo(user.email, snap.data().familyId);
          }).catch(() => {});
        } catch(e) {}
      }
      if (_authRouted) {
        console.log('[Auth] skip duplicate _routeAfterAuth');
        return;
      }
      _authRouted = true;
      _routeAfterAuth();
    });
    if ('serviceWorker' in navigator) {
      // [SW-DIAG] Registration context
      console.log('[SW-DIAG] Browser:', navigator.userAgent);
      console.log('[SW-DIAG] URL:', location.href);
      console.log('[SW-DIAG] Origin:', location.origin);
      console.log('[SW-DIAG] Secure context:', window.isSecureContext);
      console.log('[SW-DIAG] Path:', location.pathname);
      console.log('[SW-DIAG] Registration started');

      navigator.serviceWorker.register('sw.js')
        .then((reg) => {
          console.log('[SW-DIAG] Registration success');
          console.log('[SW-DIAG] Scope:', reg.scope);
          console.log('[SW-DIAG] Script URL:', reg.active?.scriptURL ?? '(no active yet)');
          console.log('[SW-DIAG] Active:', reg.active ? reg.active.state : 'null');
          console.log('[SW-DIAG] Waiting:', reg.waiting ? reg.waiting.state : 'null');
          console.log('[SW-DIAG] Installing:', reg.installing ? reg.installing.state : 'null');
        })
        .catch((err) => {
          console.error('[SW-DIAG] Registration failed');
          console.error('[SW-DIAG] Error name:', err.name);
          console.error('[SW-DIAG] Error message:', err.message);
          console.error('[SW-DIAG] Error stack:', err.stack);
        });

      // [SW-DIAG] Controller + ready state
      console.log('[SW-DIAG] controller:', navigator.serviceWorker.controller);
      navigator.serviceWorker.ready.then((reg) => {
        console.log('[SW-DIAG] ready — scope:', reg.scope);
        console.log('[SW-DIAG] ready — scriptURL:', reg.active?.scriptURL);
      });

      // [SW-DIAG] All registrations
      navigator.serviceWorker.getRegistrations().then((regs) => {
        console.log('[SW-DIAG] getRegistrations count:', regs.length);
        regs.forEach((r, i) => {
          console.log(`[SW-DIAG] Registration[${i}] scriptURL:`, r.active?.scriptURL ?? '(none)');
          console.log(`[SW-DIAG] Registration[${i}] scope:`, r.scope);
          console.log(`[SW-DIAG] Registration[${i}] active:`, r.active ? r.active.state : 'null');
          console.log(`[SW-DIAG] Registration[${i}] waiting:`, r.waiting ? r.waiting.state : 'null');
          console.log(`[SW-DIAG] Registration[${i}] installing:`, r.installing ? r.installing.state : 'null');
        });
      });
    }

  }

  /* Called after auth is confirmed (user is signed in).
     Preserves the original routing logic exactly. */
  function _routeAfterAuth() {
    // Step 1: non-standalone browser → show Landing (A2HS prompt), stop here.
    if (!isStandalone()) {
      goto('screen-landing');
      return;
    }

    // Step 2: standalone (installed PWA) — decide by data, not by platform.
    const isReturningUser = DB.get().children.length > 0;

    if (isReturningUser) {
      showSplash();
      setTimeout(() => goto('screen-dash'), SPLASH_DURATION_RETURNING);
    } else {
      showSplash();
      setTimeout(() => startOnboarding(), SPLASH_DURATION_NEW);
    }
  }

  return {
    goto, tab, openSheet, closeSheet,
    openMedSheet, pickMedChild, pickMedMedicine, addCustomMedicine, saveMed, pickReminderMode, toggleDailyReminder,
    setHistFilter, setTempFilter, openTempSheet, pickTempChild, saveTemp,
    openEditKid, saveKid, toggleNotif, init, selectChild, closeChildDetail,
    installNow, skipLanding,
    obPickParent, obPickAv, obHandlePhoto, obValidate2, obBirthChange, obValidate3, obNext, obBack,
    obActivateSupplements, obSkipSupplements, startOnboarding, obGetReturnTo: () => _obReturnTo,
    openDoseSheet, pickDoseChild, pickDoseMed, pickDoseConc, calcDose,
    openCourseSheet, pickCourseChild, pickCourseDrug, saveCourse,
    markCourseDose, deleteCourse, doneWithPRN, doneWithCourse,
    markSupplementGiven,
    heroClick, quickWeightUpdate,
    deleteMedEntry, deleteTempEntry, confirmReset,
    checkForUpdate,
    stub,
    authTab, authLogin, authSignup, authLogout,
  };
})();

document.addEventListener('DOMContentLoaded', App.init);












