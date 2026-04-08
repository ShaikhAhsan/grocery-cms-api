/**
 * Sheen Inventory: Firebase ID token exchange + session check.
 */
const express = require('express');
const jwt = require('jsonwebtoken');
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const { getFirebaseInstance } = require('../config/firebase');

const router = express.Router();

const JWT_SECRET =
  process.env.SHEEN_INVENTORY_JWT_SECRET ||
  process.env.ACCESS_TOKEN_SECRET ||
  'grocery-secret';

const JWT_EXPIRES_IN = process.env.SHEEN_INVENTORY_JWT_EXPIRES_IN || '8h';

function normalizeStatus(row) {
  if (!row) return null;
  return String(row.status || '').toLowerCase();
}

/** POST /inventory/auth/session { idToken } → accessToken if approved; 403 if pending/rejected/revoked */
router.post('/session', async (req, res) => {
  try {
    const { idToken } = req.body || {};
    if (!idToken || typeof idToken !== 'string') {
      return res.status(400).json({
        success: false,
        code: 'INVALID_BODY',
        message: 'idToken is required',
      });
    }

    let decoded;
    try {
      const { auth } = getFirebaseInstance();
      decoded = await auth.verifyIdToken(idToken, true);
    } catch (e) {
      return res.status(401).json({
        success: false,
        code: 'INVALID_FIREBASE_TOKEN',
        message: 'Invalid or expired Firebase ID token',
      });
    }

    const uid = decoded.uid;
    const email = (decoded.email || '').trim();
    const displayName =
      decoded.name || (decoded.email ? String(decoded.email).split('@')[0] : null);

    let rows = await sequelize.query(
      `SELECT * FROM sheen_inventory_access WHERE firebase_uid = ?`,
      { type: QueryTypes.SELECT, replacements: [uid] }
    );
    let row = rows[0];

    if (!row) {
      await sequelize.query(
        `INSERT INTO sheen_inventory_access (firebase_uid, email, display_name, status)
         VALUES (?, ?, ?, 'pending')`,
        { replacements: [uid, email || `uid:${uid}`, displayName] }
      );
      return res.status(403).json({
        success: false,
        code: 'PENDING_APPROVAL',
        message:
          'Access request submitted. An administrator must approve your account in CMS.',
        status: 'pending',
      });
    }

    if (email && row.email !== email) {
      await sequelize.query(
        `UPDATE sheen_inventory_access SET email = ?, display_name = COALESCE(?, display_name) WHERE id = ?`,
        { replacements: [email, displayName, row.id] }
      );
      rows = await sequelize.query(
        `SELECT * FROM sheen_inventory_access WHERE firebase_uid = ?`,
        { type: QueryTypes.SELECT, replacements: [uid] }
      );
      row = rows[0];
    }

    const status = normalizeStatus(row);
    if (status === 'pending') {
      return res.status(403).json({
        success: false,
        code: 'PENDING_APPROVAL',
        message: 'Your access request is pending administrator approval.',
        status: 'pending',
      });
    }
    if (status === 'rejected') {
      return res.status(403).json({
        success: false,
        code: 'REJECTED',
        message: 'Access was rejected.',
        status: 'rejected',
      });
    }
    if (status === 'revoked') {
      return res.status(403).json({
        success: false,
        code: 'REVOKED',
        message: 'Access was revoked. Contact an administrator.',
        status: 'revoked',
      });
    }
    if (status !== 'approved') {
      return res.status(403).json({
        success: false,
        code: 'UNKNOWN_STATUS',
        message: 'Unknown access state.',
        status,
      });
    }

    const isCostPriceVisible = !!Number(row.is_cost_price_visible);

    const accessToken = jwt.sign(
      {
        purpose: 'sheen_inventory',
        sub: uid,
        email: row.email,
        accessId: row.id,
        isCostPriceVisible,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    return res.json({
      success: true,
      accessToken,
      expiresIn: JWT_EXPIRES_IN,
      user: {
        firebaseUid: uid,
        email: row.email,
        displayName: row.display_name,
        isCostPriceVisible,
      },
      status: 'approved',
    });
  } catch (err) {
    console.error('[inventory/auth/session]', err);
    return res.status(500).json({
      success: false,
      code: 'SERVER_ERROR',
      message: err.message || 'Session failed',
    });
  }
});

/** GET /inventory/auth/me — validate Bearer inventory JWT + live DB status */
router.get('/me', async (req, res) => {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(\S+)/i);
  if (!m) {
    return res.status(401).json({
      success: false,
      code: 'AUTH_REQUIRED',
      message: 'Bearer token required',
    });
  }

  try {
    const payload = jwt.verify(m[1], JWT_SECRET);
    if (payload.purpose !== 'sheen_inventory') {
      return res.status(401).json({
        success: false,
        code: 'INVALID_TOKEN',
        message: 'Not an inventory session token',
      });
    }

    const rows = await sequelize.query(
      `SELECT id, firebase_uid, email, display_name, status, is_cost_price_visible,
              requested_at, reviewed_at
       FROM sheen_inventory_access WHERE firebase_uid = ?`,
      { type: QueryTypes.SELECT, replacements: [payload.sub] }
    );
    const row = rows[0];
    const status = normalizeStatus(row);

    if (!row) {
      return res.status(403).json({
        success: false,
        code: 'NO_ACCESS',
        message: 'No access record',
      });
    }

    if (status !== 'approved') {
      return res.status(403).json({
        success: false,
        code: status ? status.toUpperCase() : 'DENIED',
        message: 'Inventory access is not active',
        status,
      });
    }

    const isCostPriceVisible = !!Number(row.is_cost_price_visible);

    return res.json({
      success: true,
      user: {
        firebaseUid: row.firebase_uid,
        email: row.email,
        displayName: row.display_name,
        isCostPriceVisible,
      },
      status: 'approved',
    });
  } catch (e) {
    return res.status(401).json({
      success: false,
      code: 'INVALID_TOKEN',
      message: 'Invalid or expired session',
    });
  }
});

module.exports = router;
