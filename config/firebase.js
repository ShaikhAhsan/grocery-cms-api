const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

let db, auth;

function fixPrivateKey(parsed) {
  if (!parsed.private_key || typeof parsed.private_key !== 'string') return parsed;
  let key = parsed.private_key;
  if (key.includes('\\n')) key = key.replace(/\\n/g, '\n');
  if (!key.includes('\n') && key.includes('-----BEGIN')) {
    const header = '-----BEGIN PRIVATE KEY-----';
    const footer = '-----END PRIVATE KEY-----';
    const body = key.replace(header, '').replace(footer, '').replace(/\s/g, '');
    const lines = [];
    for (let i = 0; i < body.length; i += 64) lines.push(body.substring(i, i + 64));
    key = header + '\n' + lines.join('\n') + '\n' + footer;
  }
  parsed.private_key = key;
  return parsed;
}

const initializeFirebase = async () => {
  try {
    if (admin.apps.length > 0) {
      db = admin.firestore();
      auth = admin.auth();
      return { admin, db, auth };
    }

    const filePath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || path.resolve(__dirname, '../../taqdeem-7a621-firebase-adminsdk-jkrst-80d405bdde.json');
    const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);

    let serviceAccount;
    if (fs.existsSync(resolved)) {
      serviceAccount = fixPrivateKey(JSON.parse(fs.readFileSync(resolved, 'utf8')));
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON.trim();
      const json = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
      serviceAccount = fixPrivateKey(JSON.parse(json));
    } else {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON required');
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: process.env.FIREBASE_PROJECT_ID || 'taqdeem-7a621',
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'taqdeem-7a621.firebasestorage.app'
    });

    db = admin.firestore();
    auth = admin.auth();
    db.settings({ ignoreUndefinedProperties: true });

    console.log('Firebase initialized');
    return { admin, db, auth };
  } catch (error) {
    console.error('Firebase init error:', error);
    throw error;
  }
};

const getFirebaseInstance = () => {
  if (!db || !auth) throw new Error('Firebase not initialized');
  return { admin, db, auth };
};

module.exports = { initializeFirebase, getFirebaseInstance };
