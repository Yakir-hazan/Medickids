/* ─────────────────────────────────────────────────────────────────────────────
   auth.js — Firebase Auth layer  (Stage A: auth-only, no Firestore data sync)

   What this file does:
     • Signup   → creates Firebase user + users/{uid} + families/{familyId}
     • Login    → Firebase signInWithEmailAndPassword
     • Logout   → Firebase signOut
     • onAuthReady(cb) → fires cb(user|null) whenever auth state changes

   What this file does NOT do:
     • Touch localStorage / DB
     • Sync children / medEntries / prescriptions / tempEntries
     • onSnapshot / real-time
     • Store passwords (Firebase Auth handles that entirely)

   familyId is always a separate generated id — never the Firebase uid.
   ───────────────────────────────────────────────────────────────────────── */

// ── Firebase config ──────────────────────────────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyDummyKeyReplaceMe",          // ← replace with real key
  authDomain:        "medickids-app.firebaseapp.com",    // ← replace
  projectId:         "medickids-app",                    // ← replace
  storageBucket:     "medickids-app.appspot.com",        // ← replace
  messagingSenderId: "000000000000",                     // ← replace
  appId:             "1:000000000000:web:000000000000",  // ← replace
};

// ── Bootstrap Firebase (module-compatible via compat SDK loaded in index.html) ─
let _auth      = null;
let _firestore = null;

function _initFirebase() {
  if (_auth) return; // already initialised
  if (!window.firebase) {
    console.error('[Auth] Firebase SDK not loaded');
    return;
  }
  if (!firebase.apps.length) {
    firebase.initializeApp(FIREBASE_CONFIG);
  }
  _auth      = firebase.auth();
  _firestore = firebase.firestore();
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/* Generate a random familyId like "fam_k7x2qm9rz" — entirely separate from uid */
function _generateFamilyId() {
  const rand = () => Math.random().toString(36).slice(2, 8);
  return 'fam_' + rand() + rand();
}

/* Create Firestore documents for a brand-new user.
   Called only on first signup — not on every login. */
async function _bootstrapUserDocs(uid, email) {
  const familyId = _generateFamilyId();

  // users/{uid}  — maps a Firebase user to their family
  await _firestore.doc(`users/${uid}`).set({
    email,
    familyId,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });

  // families/{familyId}  — empty document, ready for future Firestore sync
  await _firestore.doc(`families/${familyId}`).set({
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    // children / medEntries / prescriptions / tempEntries / settings
    // are NOT written here — they still live in localStorage (Stage A)
  });

  return familyId;
}

/* Fetch the familyId for an existing user (used on login to surface it in Settings). */
async function _fetchFamilyId(uid) {
  try {
    const snap = await _firestore.doc(`users/${uid}`).get();
    return snap.exists ? snap.data().familyId : null;
  } catch (e) {
    console.warn('[Auth] could not fetch familyId:', e.message);
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────
const Auth = (() => {

  /* Signup — creates Firebase user, then Firestore docs.
     Returns { user, familyId } on success.
     Throws a localised-ish Error on failure (caller shows toast). */
  async function signup(email, password) {
    _initFirebase();
    const cred = await _auth.createUserWithEmailAndPassword(email, password);
    const familyId = await _bootstrapUserDocs(cred.user.uid, email);
    return { user: cred.user, familyId };
  }

  /* Login — Firebase only; no Firestore writes.
     Returns { user, familyId }. */
  async function login(email, password) {
    _initFirebase();
    const cred = await _auth.signInWithEmailAndPassword(email, password);
    const familyId = await _fetchFamilyId(cred.user.uid);
    return { user: cred.user, familyId };
  }

  /* Logout */
  async function logout() {
    _initFirebase();
    await _auth.signOut();
  }

  /* Subscribe to auth state changes.
     cb(user) — user is Firebase user object or null. */
  function onAuthReady(cb) {
    _initFirebase();
    if (!_auth) { cb(null); return; }
    _auth.onAuthStateChanged(cb);
  }

  /* Returns the currently signed-in Firebase user, or null. */
  function currentUser() {
    return _auth ? _auth.currentUser : null;
  }

  return { signup, login, logout, onAuthReady, currentUser };
})();
