const jwt = require('jsonwebtoken');
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const JWT_SECRET =
  process.env.SHEEN_INVENTORY_JWT_SECRET ||
  process.env.ACCESS_TOKEN_SECRET ||
  'grocery-secret';

function enforceAuth() {
  const v = String(process.env.SHEEN_INVENTORY_ENFORCE_AUTH ?? '1').toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off';
}

/**
 * Requires Authorization: Bearer <JWT> from POST /inventory/auth/session.
 * Re-checks DB so revoked users lose access immediately (subject to JWT TTL on errors).
 */
async function requireSheenInventoryJwt(req, res, next) {
  if (!enforceAuth()) return next();

  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(\S+)/i);
  if (!m) {
    return res.status(401).json({
      success: false,
      code: 'AUTH_REQUIRED',
      message: 'Sign in via the Sheen Inventory app (Bearer token required).',
    });
  }

  try {
    const payload = jwt.verify(m[1], JWT_SECRET);
    if (payload.purpose !== 'sheen_inventory') {
      return res.status(401).json({
        success: false,
        code: 'INVALID_TOKEN',
        message: 'Not an inventory session token.',
      });
    }

    const rows = await sequelize.query(
      `SELECT id, email, display_name, status FROM sheen_inventory_access WHERE firebase_uid = ?`,
      { type: QueryTypes.SELECT, replacements: [payload.sub] }
    );
    const row = rows[0];
    const st = row ? String(row.status).toLowerCase() : '';

    if (!row || st !== 'approved') {
      return res.status(403).json({
        success: false,
        code: 'ACCESS_DENIED',
        message:
          'Sheen Inventory access is not active (pending, rejected, or revoked).',
        status: st || null,
      });
    }

    req.sheenInventory = {
      firebaseUid: payload.sub,
      accessId: row.id,
      email: row.email,
      displayName: row.display_name,
    };
    return next();
  } catch (e) {
    return res.status(401).json({
      success: false,
      code: 'INVALID_TOKEN',
      message: 'Invalid or expired session. Sign in again.',
    });
  }
}

module.exports = requireSheenInventoryJwt;
