const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

const { sequelize } = require('./config/database');
const { initializeFirebase, getFirebaseInstance } = require('./config/firebase');
const { initializeFirebaseStorage, isGCSAvailable, uploadToGCS, deleteFromGCS } = require('./services/googleCloudStorage');
const errorHandler = require('./middleware/errorHandler');
const menuRoutes = require('./routes/menu');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = parseInt(process.env.PORT || '8002', 10);

app.use(helmet());
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

app.get('/health', async (req, res) => {
  const checks = {
    db: { ok: false, message: '' },
    firebase: { ok: false, message: '' },
    firebaseStorage: { ok: false, message: '' },
  };

  // 1. Database connection
  try {
    await sequelize.authenticate();
    checks.db = { ok: true, message: 'Connected successfully' };
  } catch (err) {
    checks.db = { ok: false, message: err.message || 'Connection failed' };
  }

  // 2. Firebase (Auth/Firestore)
  try {
    const { db } = getFirebaseInstance();
    await db.collection('_health_check').limit(1).get();
    checks.firebase = { ok: true, message: 'Connected successfully' };
  } catch (err) {
    checks.firebase = { ok: false, message: err.message || 'Not initialized or connection failed' };
  }

  // 3. Firebase Storage - test upload
  if (isGCSAvailable()) {
    try {
      const minimalPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQwAADgAEA4T3bKQAAAABJRU5ErkJggg==', 'base64');
      const result = await uploadToGCS(minimalPng, 'health-check-test.png', 'health-check', 'image/png');
      checks.firebaseStorage = { ok: true, message: 'Upload test passed' };
      try { await deleteFromGCS(result.fileName); } catch { /* cleanup */ }
    } catch (err) {
      checks.firebaseStorage = { ok: false, message: err.message || 'Upload test failed' };
    }
  } else {
    checks.firebaseStorage = { ok: false, message: 'Firebase Storage not configured' };
  }

  const allOk = checks.db.ok && checks.firebase.ok && checks.firebaseStorage.ok;
  const status = allOk ? 'OK' : 'DEGRADED';

  if (req.accepts('json')) {
    return res.json({
      status,
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      environment: process.env.NODE_ENV,
      checks,
    });
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Grocery CMS API Health</title>
<style>body{font-family:system-ui,sans-serif;max-width:600px;margin:2rem auto;padding:0 1rem;color:#333}
h1{color:#111}h2{font-size:1rem;color:#666;margin-top:2rem}
.item{display:flex;align-items:center;gap:.75rem;padding:.5rem 0;border-bottom:1px solid #eee}
.status{font-weight:600;min-width:100px}.ok{color:#059669}.fail{color:#dc2626}</style>
</head>
<body>
<h1>Grocery CMS API Health</h1>
<p>Status: <strong>${status}</strong> &bull; Uptime: ${Math.floor(process.uptime())}s</p>
<h2>Database (MySQL)</h2>
<div class="item"><span class="status ${checks.db.ok ? 'ok' : 'fail'}">${checks.db.ok ? '✓ Connected' : '✗ Failed'}</span><span>${checks.db.message}</span></div>
<h2>Firebase (Auth/Firestore)</h2>
<div class="item"><span class="status ${checks.firebase.ok ? 'ok' : 'fail'}">${checks.firebase.ok ? '✓ Connected' : '✗ Failed'}</span><span>${checks.firebase.message}</span></div>
<h2>Firebase Storage</h2>
<div class="item"><span class="status ${checks.firebaseStorage.ok ? 'ok' : 'fail'}">${checks.firebaseStorage.ok ? '✓ Working' : '✗ Failed'}</span><span>${checks.firebaseStorage.message}</span></div>
</body>
</html>`;
  res.setHeader('Content-Type', 'text/html').send(html);
});

app.get('/api/v1', (req, res) => {
  res.json({ message: 'Grocery CMS API', version: '1.0' });
});

app.use('/api/v1/menu', menuRoutes);
app.use('/api/v1/admin', adminRoutes);

app.use('*', (req, res) => res.status(404).json({ success: false, error: 'Not found' }));
app.use(errorHandler);

const init = async () => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Grocery CMS API on port ${PORT}`);
  });
  try {
    await initializeFirebase();
    const gcsOk = initializeFirebaseStorage();
    await sequelize.authenticate();
    console.log('DB and Firebase ready' + (gcsOk ? ' (Storage OK)' : ' (Storage not configured)'));
  } catch (e) {
    console.error('Init error:', e.message);
  }
};

init();
