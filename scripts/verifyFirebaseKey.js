#!/usr/bin/env node
/**
 * Diagnose Firebase / Google service account credentials.
 * Run from grocery-cms-api: node scripts/verifyFirebaseKey.js
 *
 * - If "local RSA sign" fails → PEM in .env is corrupted (truncated, bad escapes).
 * - If local sign OK but getAccessToken fails with Invalid JWT Signature → Google does not
 *   recognize this private key anymore. Create a NEW key in Firebase Console and replace
 *   FIREBASE_SERVICE_ACCOUNT_JSON (and delete the old key in Google Cloud → IAM → Service Accounts).
 */
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!raw || !raw.trim()) {
  console.error('FIREBASE_SERVICE_ACCOUNT_JSON is empty. Set it in .env or use a JSON file + GOOGLE_APPLICATION_CREDENTIALS.');
  process.exit(1);
}

let sa;
try {
  sa = JSON.parse(raw.trim().replace(/^\uFEFF/, ''));
} catch (e) {
  console.error('JSON parse failed:', e.message);
  process.exit(1);
}

let pk = sa.private_key;
if (typeof pk === 'string' && pk.includes('\\n')) pk = pk.replace(/\\n/g, '\n');

console.log('client_email:', sa.client_email);
console.log('project_id:', sa.project_id);
console.log('private_key_id:', sa.private_key_id);
console.log('private_key length:', pk.length);

try {
  const sign = crypto.createSign('RSA-SHA256');
  sign.update('verify');
  sign.sign(pk);
  console.log('local RSA-SHA256 sign: OK (PEM is usable locally)');
} catch (e) {
  console.error('local RSA-SHA256 sign: FAIL —', e.message);
  console.error('Fix: restore full PEM in JSON (host panels often truncate long env vars).');
  process.exit(1);
}

const { GoogleAuth } = require('google-auth-library');
const auth = new GoogleAuth({
  credentials: sa,
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

auth
  .getClient()
  .then((c) => c.getAccessToken())
  .then(() => {
    console.log('Google OAuth getAccessToken: OK — credentials are valid on Google’s side.');
    process.exit(0);
  })
  .catch((e) => {
    console.error('Google OAuth getAccessToken: FAIL —', e.message);
    if (String(e.message).includes('JWT') || String(e.message).includes('invalid_grant')) {
      console.error('\nThis almost always means the private key is no longer active for this service account.');
      console.error('Fix: Firebase Console → Project settings → Service accounts → Generate new private key,');
      console.error('     update .env (or upload JSON and set GOOGLE_APPLICATION_CREDENTIALS), then revoke/delete the old key in Google Cloud Console.');
    }
    process.exit(1);
  });
