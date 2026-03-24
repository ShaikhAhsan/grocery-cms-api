const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

let auth;

const apiRoot = path.join(__dirname, '..');

function normalizeJsonEnv(raw) {
  if (raw == null) return '';
  return String(raw).replace(/^\uFEFF/, '').trim();
}

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

function assertServiceAccountShape(sa) {
  if (!sa.client_email || !sa.private_key || !sa.project_id) {
    throw new Error(
      'Service account JSON missing client_email, private_key, or project_id. If this is production, the env value may be truncated — use a JSON file and GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT_PATH.'
    );
  }
  const pk = String(sa.private_key);
  if (!pk.includes('BEGIN PRIVATE KEY') || !pk.includes('END PRIVATE KEY')) {
    throw new Error('private_key is not a valid PEM (often truncated when pasted into a host panel).');
  }
  if (pk.length < 800) {
    console.warn(
      `[Firebase] private_key length ${pk.length} is unusually short; JWT signature errors are likely. Full PEM is typically 1600+ characters.`
    );
  }
}

function initializeAppWithCert(serviceAccount, credentialLabel) {
  assertServiceAccountShape(serviceAccount);
  const projectId = serviceAccount.project_id;
  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PROJECT_ID !== projectId) {
    console.warn(
      `[Firebase] Ignoring FIREBASE_PROJECT_ID=${process.env.FIREBASE_PROJECT_ID}; using project_id from the key (${projectId}).`
    );
  }
  const storageBucket =
    process.env.FIREBASE_STORAGE_BUCKET ||
    `${projectId}.firebasestorage.app`;

  console.log(
    `[Firebase] ${credentialLabel} project_id=${projectId} client=${serviceAccount.client_email} private_key_len=${String(serviceAccount.private_key).length}`
  );

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId,
    storageBucket,
  });
}

const initializeFirebase = async () => {
  try {
    if (admin.apps.length > 0) {
      auth = admin.auth();
      return { admin, auth };
    }

    const filePath =
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
      path.join(apiRoot, 'firebase-service-account.json');
    const resolvedFile = path.isAbsolute(filePath) ? filePath : path.resolve(apiRoot, filePath);

    const gacRaw = (process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
    const gacResolved = gacRaw && (path.isAbsolute(gacRaw) ? gacRaw : path.resolve(apiRoot, gacRaw));

    const jsonEnv = normalizeJsonEnv(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);

    if (gacResolved && fs.existsSync(gacResolved)) {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = gacResolved;
      const sa = fixPrivateKey(JSON.parse(fs.readFileSync(gacResolved, 'utf8')));
      assertServiceAccountShape(sa);
      const projectId = sa.project_id;
      const storageBucket =
        process.env.FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app`;
      if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PROJECT_ID !== projectId) {
        console.warn(
          `[Firebase] Ignoring FIREBASE_PROJECT_ID=${process.env.FIREBASE_PROJECT_ID}; ADC key is for ${projectId}.`
        );
      }
      console.log(
        `[Firebase] GOOGLE_APPLICATION_CREDENTIALS=${gacResolved} project_id=${projectId} client=${sa.client_email} private_key_len=${String(sa.private_key).length}`
      );
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId,
        storageBucket,
      });
    } else if (jsonEnv) {
      const json = jsonEnv.startsWith('{') ? jsonEnv : Buffer.from(jsonEnv, 'base64').toString('utf8');
      const serviceAccount = fixPrivateKey(JSON.parse(json));
      initializeAppWithCert(serviceAccount, 'FIREBASE_SERVICE_ACCOUNT_JSON');
    } else if (fs.existsSync(resolvedFile)) {
      const serviceAccount = fixPrivateKey(JSON.parse(fs.readFileSync(resolvedFile, 'utf8')));
      initializeAppWithCert(serviceAccount, `file:${resolvedFile}`);
    } else {
      throw new Error(
        'No Firebase credentials: set GOOGLE_APPLICATION_CREDENTIALS, FIREBASE_SERVICE_ACCOUNT_JSON, or FIREBASE_SERVICE_ACCOUNT_PATH / firebase-service-account.json'
      );
    }

    auth = admin.auth();
    console.log('Firebase initialized');
    return { admin, auth };
  } catch (error) {
    console.error('Firebase init error:', error);
    throw error;
  }
};

const getFirebaseInstance = () => {
  if (!auth) throw new Error('Firebase not initialized');
  return { admin, auth };
};

module.exports = { initializeFirebase, getFirebaseInstance };
