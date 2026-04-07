/**
 * Admin CRUD API - Tables from grocery_store_db (excludes backup_categories, backup_products)
 */
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const router = express.Router();
const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');
const schema = require('../db_schema.json');

function isDuplicateKeyError(err) {
  const orig = err?.original || err?.parent;
  const code = orig?.code || err?.code;
  const errno = orig?.errno ?? err?.errno;
  if (code === 'ER_DUP_ENTRY' || errno === 1062) return true;
  const msg = String(orig?.sqlMessage || err?.message || '');
  return /duplicate entry/i.test(msg);
}

/**
 * @returns {{ userMessage: string, duplicateField: string|null }}
 */
function duplicateKeyMeta(err, table) {
  const msg = String(err?.original?.sqlMessage || err?.parent?.sqlMessage || err?.message || '');
  const keyMatch = msg.match(/for key ['"](?:[^.']*\.)?([^'"]+)['"]/i);
  let duplicateField = null;
  if (keyMatch) {
    let keyName = keyMatch[1];
    const dotParts = keyName.split('.');
    duplicateField = dotParts[dotParts.length - 1];
    if (/^primary$/i.test(duplicateField)) duplicateField = 'id';
    else {
      duplicateField = duplicateField
        .replace(/^uk_/i, '')
        .replace(/_unique$/i, '')
        .replace(/_key$/i, '');
      if (table) {
        const tbl = String(table).replace(/-/g, '_');
        const prefix = `${tbl}_`;
        if (duplicateField.startsWith(prefix)) {
          duplicateField = duplicateField.slice(prefix.length);
        }
      }
    }
  }
  let userMessage = 'This value already exists.';
  if (duplicateField) {
    if (duplicateField === 'id') userMessage = 'This ID is already in use.';
    else userMessage = `This ${duplicateField.replace(/_/g, ' ')} is already in use.`;
  }
  return { userMessage, duplicateField };
}

function respondWriteError(err, res, table) {
  if (isDuplicateKeyError(err)) {
    const { userMessage, duplicateField } = duplicateKeyMeta(err, table);
    return res.status(409).json({
      success: false,
      error: userMessage,
      code: 'DUPLICATE_ENTRY',
      duplicateField,
    });
  }
  return res.status(500).json({ success: false, error: err.message });
}

const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const uploadMicroserviceBase = (
  process.env.UPLOAD_MICROSERVICE_URL || 'http://109.106.244.241:9007'
).replace(/\/$/, '');

const api = (table, cols, idCol = 'id') => ({
  list: async (req, res) => {
    try {
      const { limit = 500, offset = 0 } = req.query;
      const where = req.query.where ? ` WHERE ${req.query.where}` : '';
      const order = req.query.orderBy ? ` ORDER BY ${req.query.orderBy}` : ` ORDER BY \`${idCol}\``;
      const rows = await sequelize.query(
        `SELECT * FROM \`${table}\`${where}${order} LIMIT :limit OFFSET :offset`,
        { type: QueryTypes.SELECT, replacements: { limit: parseInt(limit, 10), offset: parseInt(offset, 10) } }
      );
      const [countRow] = await sequelize.query(
        `SELECT COUNT(*) as c FROM \`${table}\`${where}`,
        { type: QueryTypes.SELECT }
      );
      res.json({ success: true, data: rows, total: countRow?.c ?? 0 });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  },
  get: async (req, res) => {
    try {
      const [row] = await sequelize.query(
        `SELECT * FROM \`${table}\` WHERE \`${idCol}\` = :pkId`,
        { type: QueryTypes.SELECT, replacements: { pkId: req.params.id } }
      );
      if (!row) return res.status(404).json({ success: false, error: 'Not found' });
      res.json({ success: true, data: row });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  },
  create: async (req, res) => {
    try {
      const body = req.body || {};
      const keys = cols.filter((c) => body[c] !== undefined);
      if (keys.length === 0) {
        return res.status(400).json({ success: false, error: 'No valid fields to insert' });
      }
      const colList = keys.map((k) => `\`${k}\``).join(', ');
      const valList = keys.map((k) => `:${k}`).join(', ');
      await sequelize.query(
        `INSERT INTO \`${table}\` (${colList}) VALUES (${valList})`,
        { replacements: keys.reduce((a, k) => ({ ...a, [k]: body[k] }), {}) }
      );
      const lastRows = await sequelize.query(
        'SELECT LAST_INSERT_ID() as id',
        { type: QueryTypes.SELECT }
      );
      const insertId = (Array.isArray(lastRows) ? lastRows[0] : lastRows)?.id;
      if (insertId == null || insertId === 0) {
        return res.status(500).json({ success: false, error: 'Failed to get insert ID' });
      }
      const [row] = await sequelize.query(
        `SELECT * FROM \`${table}\` WHERE \`${idCol}\` = :pkId`,
        { type: QueryTypes.SELECT, replacements: { pkId: insertId } }
      );
      res.status(201).json({ success: true, data: row });
    } catch (err) {
      return respondWriteError(err, res, table);
    }
  },
  update: async (req, res) => {
    try {
      const body = req.body || {};
      const keys = cols.filter((c) => body[c] !== undefined && c !== idCol);
      if (keys.length === 0) {
        const [row] = await sequelize.query(
          `SELECT * FROM \`${table}\` WHERE \`${idCol}\` = :pkId`,
          { type: QueryTypes.SELECT, replacements: { pkId: req.params.id } }
        );
        return res.json({ success: true, data: row });
      }
      const setClause = keys.map((k) => `\`${k}\` = :${k}`).join(', ');
      await sequelize.query(
        `UPDATE \`${table}\` SET ${setClause} WHERE \`${idCol}\` = :pkId`,
        { replacements: { ...keys.reduce((a, k) => ({ ...a, [k]: body[k] }), {}), pkId: req.params.id } }
      );
      const [row] = await sequelize.query(
        `SELECT * FROM \`${table}\` WHERE \`${idCol}\` = :pkId`,
        { type: QueryTypes.SELECT, replacements: { pkId: req.params.id } }
      );
      res.json({ success: true, data: row });
    } catch (err) {
      return respondWriteError(err, res, table);
    }
  },
  delete: async (req, res) => {
    try {
      const [r] = await sequelize.query(
        `DELETE FROM \`${table}\` WHERE \`${idCol}\` = :pkId`,
        { replacements: { pkId: req.params.id } }
      );
      if (r.affectedRows === 0) return res.status(404).json({ success: false, error: 'Not found' });
      res.json({ success: true, deleted: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  },
});

const mount = (path, table, cols, idCol = 'id') => {
  const a = api(table, cols, idCol);
  router.get(path, a.list);
  router.get(`${path}/:id`, a.get);
  router.post(path, a.create);
  router.put(`${path}/:id`, a.update);
  router.delete(`${path}/:id`, a.delete);
};

/**
 * Active products for a brand (non-deleted). Dedicated path avoids any clash with /brand/:id.
 * GET /api/v1/admin/brand-product-count/:id
 */
router.get('/brand-product-count/:id', async (req, res) => {
  try {
    const idRaw = req.params.id;
    const id = parseInt(idRaw, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Invalid brand id' });
    }
    const [row] = await sequelize.query(
      `SELECT COUNT(*) as c FROM products WHERE brand_id = :id AND (is_deleted = 0 OR is_deleted IS NULL)`,
      { type: QueryTypes.SELECT, replacements: { id } }
    );
    const count = Number(row?.c ?? 0);
    res.json({ success: true, data: { count } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Proxy to image microservice POST /upload so the browser does not need CORS on :9007.
 * Same multipart field names as the microservice: image, id, type, mainImageMaxWidth, etc.
 */
router.post('/upload-microservice', uploadMemory.single('image'), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ success: false, error: 'image file is required' });
    }
    const form = new FormData();
    form.append('image', req.file.buffer, {
      filename: req.file.originalname || 'upload.jpg',
      contentType: req.file.mimetype || 'image/jpeg',
    });
    const fieldNames = [
      'id',
      'type',
      'mainImageMaxWidth',
      'mainImageMaxHeight',
      'thumbMaxWidth',
      'thumbMaxHeight',
      'skipTrim',
    ];
    let forwardedSkipTrim = false;
    for (const name of fieldNames) {
      const v = req.body[name];
      if (v != null && String(v).length) {
        form.append(name, String(v));
        if (name === 'skipTrim') forwardedSkipTrim = true;
      }
    }
    if (!forwardedSkipTrim) form.append('skipTrim', 'true');
    const target = `${uploadMicroserviceBase}/upload`;
    const response = await axios.post(target, form, {
      headers: form.getHeaders(),
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      validateStatus: () => true,
      timeout: 120000,
    });
    if (typeof response.data === 'object' && response.data !== null) {
      return res.status(response.status).json(response.data);
    }
    return res.status(response.status).send(response.data);
  } catch (err) {
    const status = err.response?.status || 502;
    const payload = err.response?.data;
    if (payload && typeof payload === 'object') {
      return res.status(status).json(payload);
    }
    return res.status(502).json({
      success: false,
      error: err.message || 'Upload proxy failed',
    });
  }
});

// Mount CRUD for all tables from schema (excludes backup_categories, backup_products, audit_logs)
Object.entries(schema).forEach(([table, { pk, cols }]) => {
  if (table === 'audit_logs') return; // read-only below
  const path = '/' + table.replace(/_/g, '-');
  mount(path, table, cols, pk);
});

// Audit logs - read-only (no create/update/delete)
router.get('/audit-logs', async (req, res) => {
  try {
    const { limit = 100, offset = 0, table_name, record_id } = req.query;
    let where = '';
    const reps = { limit: parseInt(limit, 10), offset: parseInt(offset, 10) };
    if (table_name) { where += ' AND table_name = :table_name'; reps.table_name = table_name; }
    if (record_id) { where += ' AND record_id = :record_id'; reps.record_id = record_id; }
    const rows = await sequelize.query(
      `SELECT * FROM audit_logs WHERE 1=1${where} ORDER BY created_at DESC LIMIT :limit OFFSET :offset`,
      { type: QueryTypes.SELECT, replacements: reps }
    );
    const [countRow] = await sequelize.query(
      `SELECT COUNT(*) as c FROM audit_logs WHERE 1=1${where}`,
      { type: QueryTypes.SELECT, replacements: reps }
    );
    res.json({ success: true, data: rows, total: countRow?.c ?? 0 });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
