/* =============================================================
   auth.js — Firebase Auth layer for MediKids
   שלב A: התחברות בלבד. אין sync של נתוני DB.

   מבנה Firestore:
     users/{uid}       → { email, familyId, createdAt }
     families/{famId}  → { createdAt, members: [uid] }

   familyId ≠ uid — מבנה נכון לחיבור עתידי של שני הורים.
   סיסמה לא נשמרת כאן — Firebase Auth מנהל אותה.
============================================================= */

const Auth = (() => {

  // ─── Firebase config ──────────────────────────────────────
  // ⚠️ CLAUDE: apiKey מגיע מ-Firebase Console → Project Settings → Your apps
  const FIREBASE_CONFIG = {
    apiKey:            "AIzaSyBg2izecXmu0dHDCSpUAOe2JztbhdTQ7gY",
    authDomain:        "medickids-4b5de.firebaseapp.com",
    projectId:         "medickids-4b5de",
    storageBucket:     "medickids-4b5de.firebasestorage.app",
    messagingSenderId: "1015048057094",
    appId:             "1:1015048057094:web:3042aff8ba22a643e76e87",
    measurementId:     "G-W1FRY2Q8QV",
  };

  // ─── state ────────────────────────────────────────────────
  let _auth     = null;
  let _db       = null;
  let _user     = null;       // Firebase user object או null
  let _familyId = null;       // מזהה המשפחה (לא ה-uid!)
  let _ready    = false;      // onAuthStateChanged ירץ לפחות פעם אחת
  let _readyCbs = [];
  let _mode     = 'login';    // 'login' | 'signup' — מצב UI נוכחי

  // ─── init ─────────────────────────────────────────────────
  async function init() {
    await _loadScript('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
    await _loadScript('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js');
    await _loadScript('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js');

    if (!firebase.apps.length) {
      firebase.initializeApp(FIREBASE_CONFIG);
    }
    _auth = firebase.auth();
    _db   = firebase.firestore();

    _auth.onAuthStateChanged(async (user) => {
      _user = user;
      if (user) {
        _familyId = await _loadOrCreateFamily(user);
      } else {
        _familyId = null;
      }
      if (!_ready) {
        _ready = true;
        _readyCbs.forEach((cb) => cb(user));
        _readyCbs = [];
      }
    });
  }

  // ─── helpers ──────────────────────────────────────────────
  function _loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`נכשלה טעינת: ${src}`));
      document.head.appendChild(s);
    });
  }

  async function _loadOrCreateFamily(user) {
    const userDoc = await _db.collection('users').doc(user.uid).get();
    if (userDoc.exists) {
      return userDoc.data().familyId;
    }
    // משתמש חדש — צור familyId ייחודי (לא ה-uid!)
    const famId = 'fam_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const batch = _db.batch();
    batch.set(_db.collection('users').doc(user.uid), {
      email:     user.email,
      familyId:  famId,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    batch.set(_db.collection('families').doc(famId), {
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      members:   [user.uid],
    });
    await batch.commit();
    return famId;
  }

  function _setLoading(on) {
    const form    = document.querySelector('.auth-form');
    const loading = document.getElementById('auth-loading');
    const btn     = document.getElementById('auth-submit');
    if (form)    form.style.display    = on ? 'none' : 'flex';
    if (loading) loading.style.display = on ? 'block' : 'none';
    if (btn)     btn.disabled          = on;
  }

  function _showError(msg) {
    const el = document.getElementById('auth-error');
    if (!el) return;
    el.textContent    = msg;
    el.style.display  = msg ? 'block' : 'none';
  }

  function _firebaseError(err) {
    const map = {
      'auth/user-not-found':      'לא נמצא חשבון עם האימייל הזה',
      'auth/wrong-password':      'סיסמה שגויה',
      'auth/invalid-credential':  'אימייל או סיסמה שגויים',
      'auth/email-already-in-use':'האימייל הזה כבר רשום — נסו להתחבר',
      'auth/weak-password':       'הסיסמה קצרה מדי — לפחות 6 תווים',
      'auth/invalid-email':       'כתובת אימייל לא תקינה',
      'auth/network-request-failed': 'בעיית רשת — בדקו חיבור לאינטרנט',
      'auth/too-many-requests':   'יותר מדי ניסיונות — נסו שוב מאוחר יותר',
    };
    return map[err.code] || `שגיאה: ${err.message}`;
  }

  // ─── UI actions ───────────────────────────────────────────

  function showTab(mode) {
    _mode = mode;
    _showError('');
    const p2 = document.getElementById('auth-password2');
    const btn = document.getElementById('auth-submit');
    const t1  = document.getElementById('tab-login');
    const t2  = document.getElementById('tab-signup');
    if (p2)  p2.style.display  = mode === 'signup' ? 'block' : 'none';
    if (btn) btn.textContent   = mode === 'signup' ? 'הרשמה' : 'כניסה';
    if (t1)  t1.classList.toggle('active', mode === 'login');
    if (t2)  t2.classList.toggle('active', mode === 'signup');
  }

  async function submit() {
    _showError('');
    const email = (document.getElementById('auth-email')?.value || '').trim();
    const pass  = document.getElementById('auth-password')?.value || '';
    const pass2 = document.getElementById('auth-password2')?.value || '';

    if (!email || !pass) { _showError('אנא מלאו אימייל וסיסמה'); return; }
    if (_mode === 'signup' && pass !== pass2) { _showError('הסיסמאות לא תואמות'); return; }
    if (_mode === 'signup' && pass.length < 6) { _showError('הסיסמה חייבת להיות לפחות 6 תווים'); return; }

    _setLoading(true);
    try {
      if (_mode === 'signup') {
        await signup(email, pass);
      } else {
        await login(email, pass);
      }
      // onAuthStateChanged יטפל בהמשך — App.init יקרא לו
    } catch (err) {
      _showError(_firebaseError(err));
      _setLoading(false);
    }
  }

  // ─── public API ───────────────────────────────────────────

  function onReady(cb) {
    if (_ready) { cb(_user); return; }
    _readyCbs.push(cb);
  }

  async function signup(email, password) {
    const cred = await _auth.createUserWithEmailAndPassword(email, password);
    return cred.user;
  }

  async function login(email, password) {
    const cred = await _auth.signInWithEmailAndPassword(email, password);
    return cred.user;
  }

  async function logout() {
    await _auth.signOut();
    // App.init ידאג לנתב ל-screen-auth
    window.location.reload();
  }

  function currentUser()     { return _user; }
  function currentFamilyId() { return _familyId; }
  function isLoggedIn()      { return !!_user; }

  return {
    init, onReady,
    signup, login, logout,
    showTab, submit,
    currentUser, currentFamilyId, isLoggedIn,
  };
})();
