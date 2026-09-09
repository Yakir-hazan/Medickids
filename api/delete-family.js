// api/delete-family.js — Vercel Serverless Function
//
// Full Reset: permanently deletes ALL of a family's data from Firestore
// (children, medicines, medEntries, tempEntries, prescriptions, _meta/migration).
//
// SECURITY: the familyId to delete is NEVER taken from the request. It is derived
// server-side, only, from: verified Firebase ID token → uid → users/{uid}.familyId.
// A client cannot delete a family it doesn't belong to, no matter what it sends.
//
// Leaves untouched, intentionally: families/{familyId} root doc, users/{uid} doc —
// so the account can still log back in to a (now-empty) family afterwards.
//
// Requires FIREBASE_SERVICE_ACCOUNT_KEY as a Vercel Environment Variable: the full
// JSON contents of a Firebase service account key (Project Settings → Service
// Accounts → Generate new private key), stored as a single-line JSON string.
// NEVER commit this key to the repo — Environment Variables only.

import admin from 'firebase-admin';

function getAdmin() {
  if (!admin.apps.length) {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY environment variable is not set');
    }
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
  return admin;
}

// Must match SYNCED_COLLECTIONS in js/db.js — kept as a separate literal here
// deliberately, since this file has no access to the client bundle.
const SYNCED_COLLECTIONS = ['children', 'medicines', 'medEntries', 'tempEntries', 'prescriptions'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://medickids.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── 1. Verify the caller ──────────────────────────────────────────────────
  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken) return res.status(401).json({ error: 'Missing bearer token' });

  let adminApp, uid;
  try {
    adminApp = getAdmin();
    const decoded = await adminApp.auth().verifyIdToken(idToken);
    uid = decoded.uid;
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token', detail: e.message });
  }

  const db = adminApp.firestore();

  // ── 2. Resolve familyId server-side ONLY — request body is never read for this ──
  let familyId;
  try {
    const userSnap = await db.doc(`users/${uid}`).get();
    if (!userSnap.exists || !userSnap.data().familyId) {
      return res.status(404).json({ error: 'No family associated with this account' });
    }
    familyId = userSnap.data().familyId;
  } catch (e) {
    return res.status(500).json({ error: 'Could not resolve family', detail: e.message });
  }

  // ── 3. Delete every synced collection under this family, honestly ──────────
  // recursiveDelete() is NOT a single atomic transaction — it deletes in batches.
  // We track each collection's outcome individually and only report success if
  // every single one genuinely completed. A partial failure is reported as such,
  // never masked as success.
  const familyRef = db.doc(`families/${familyId}`);
  const results = {};
  let allOk = true;

  for (const col of SYNCED_COLLECTIONS) {
    try {
      await db.recursiveDelete(familyRef.collection(col));
      results[col] = 'deleted';
    } catch (e) {
      allOk = false;
      results[col] = `failed: ${e.message}`;
    }
  }

  try {
    await familyRef.collection('_meta').doc('migration').delete();
    results['_meta/migration'] = 'deleted';
  } catch (e) {
    allOk = false;
    results['_meta/migration'] = `failed: ${e.message}`;
  }

  // families/{familyId} root doc and users/{uid} are intentionally left in place.

  if (!allOk) {
    return res.status(500).json({ success: false, partial: true, familyId, results });
  }
  return res.status(200).json({ success: true, familyId, results });
}
