/**
 * Admin CRUD API - Tables from grocery_store_db (excludes backup_categories, backup_products)
 */
const express = require('express');
const http = require('http');
const https = require('https');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const router = express.Router();
const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');
const schema = require('../db_schema.json');
const geminiProductAi = require('../services/geminiProductAi');

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
  if (err?.status === 400 || err?.code === 'VALIDATION_ERROR') {
    return res.status(400).json({ success: false, error: err.message || 'Validation failed' });
  }
  if (err.duplicateField) {
    return res.status(409).json({
      success: false,
      error: err.message || 'This value already exists.',
      code: 'DUPLICATE_ENTRY',
      duplicateField: err.duplicateField,
    });
  }
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

function validationError(messageText) {
  const err = new Error(messageText);
  err.status = 400;
  err.code = 'VALIDATION_ERROR';
  return err;
}

function hasTextValue(value) {
  return String(value ?? '').trim().length > 0;
}

async function assertProductRequiredFieldsOnWrite(table, idCol, body, updateId = null) {
  if (table !== 'products') return;
  const requiredLabels = {
    product_name: 'product_name',
    unit: 'unit',
    slug: 'slug',
    image: 'image',
  };
  const requiredKeys = Object.keys(requiredLabels);
  if (updateId == null) {
    for (const key of requiredKeys) {
      if (!hasTextValue(body?.[key])) {
        throw validationError(`${requiredLabels[key]} is required`);
      }
    }
    return;
  }

  const [existing] = await sequelize.query(
    `SELECT \`product_name\`, \`unit\`, \`slug\`, \`image\` FROM \`products\` WHERE \`${idCol}\` = :pkId`,
    { type: QueryTypes.SELECT, replacements: { pkId: updateId } }
  );
  if (!existing) {
    throw validationError('Product not found');
  }

  for (const key of requiredKeys) {
    const value = body?.[key] !== undefined ? body[key] : existing[key];
    if (!hasTextValue(value)) {
      throw validationError(`${requiredLabels[key]} is required`);
    }
  }
}

/**
 * Enforce unique `slug` among non-deleted rows (if `is_deleted` exists), excluding one primary key (for updates).
 */
async function assertSlugUnique(table, cols, idCol, slugValue, excludePkId) {
  if (!cols.includes('slug')) return;
  if (slugValue == null) return;
  const slug = String(slugValue).trim();
  if (slug === '') return;

  const parts = ['`slug` = :slug'];
  const replacements = { slug };
  if (excludePkId != null && String(excludePkId).length > 0) {
    parts.push(`\`${idCol}\` != :excludePk`);
    replacements.excludePk = excludePkId;
  }
  if (cols.includes('is_deleted')) {
    parts.push('(`is_deleted` = 0 OR `is_deleted` IS NULL)');
  }
  const sql = `SELECT \`${idCol}\` FROM \`${table}\` WHERE ${parts.join(' AND ')} LIMIT 1`;
  const [row] = await sequelize.query(sql, { type: QueryTypes.SELECT, replacements });
  if (row) {
    const err = new Error('This slug is already in use.');
    err.duplicateField = 'slug';
    throw err;
  }
}

const REPORT_ALLOWED_TYPES = new Set([
  'text',
  'textarea',
  'number',
  'date',
  'datetime',
  'dropdown',
  'multi_dropdown',
  'radio',
  'checkbox',
]);
const REPORT_MULTI_VALUE_TYPES = new Set(['multi_dropdown', 'checkbox']);
const REPORT_OUTPUT_TYPES = new Set(['list', 'count', 'chart', 'images']);

function reportSlugify(raw) {
  return String(raw || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180);
}

function reportKeyify(raw) {
  return String(raw || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function reportCanonicalToken(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeReadOnlySelectSql(sqlRaw) {
  let sql = String(sqlRaw || '').trim();
  if (!sql) throw new Error('Query is required');
  if (/--|\/\*|\*\//.test(sql)) {
    throw new Error('SQL comments are not allowed in report query');
  }
  sql = sql.replace(/;\s*$/, '').trim();
  if (!sql) throw new Error('Query is required');
  if (sql.includes(';')) {
    throw new Error('Only a single read-only SQL statement is allowed');
  }
  if (!/^(select|with)\b/i.test(sql)) {
    throw new Error('Report query must start with SELECT or WITH');
  }
  if (
    /\b(insert|update|delete|alter|drop|truncate|create|replace|grant|revoke|rename|call|execute|set|lock|unlock|commit|rollback|start\s+transaction)\b/i.test(
      sql
    )
  ) {
    throw new Error('Only read-only SELECT queries are allowed');
  }
  return sql;
}

function parseReportInputFields(rawInputs) {
  const arr = Array.isArray(rawInputs) ? rawInputs : [];
  if (arr.length > 60) throw new Error('Too many input fields (max 60)');
  return arr.map((item, i) => {
    const row = item && typeof item === 'object' ? item : {};
    const label = String(row.label || '').trim();
    if (!label) throw new Error(`Input #${i + 1}: label is required`);
    const key = reportKeyify(row.key || label);
    if (!key) throw new Error(`Input #${i + 1}: key is invalid`);
    const typeRaw = String(row.type || 'text').trim().toLowerCase();
    const type = REPORT_ALLOWED_TYPES.has(typeRaw) ? typeRaw : 'text';
    const required = row.required === true || row.required === 1 || row.required === '1';
    const placeholder = String(row.placeholder || '').trim().slice(0, 200);
    const options = Array.isArray(row.options)
      ? row.options
          .map((v) => String(v || '').trim())
          .filter(Boolean)
          .slice(0, 500)
      : [];
    if (
      (type === 'dropdown' || type === 'multi_dropdown' || type === 'radio' || type === 'checkbox') &&
      options.length === 0
    ) {
      throw new Error(`Input "${label}" requires options`);
    }
    return {
      key,
      label: label.slice(0, 120),
      type,
      required,
      placeholder,
      options,
    };
  });
}

function parseImageColumns(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v) => String(v || '').trim())
    .filter(Boolean)
    .slice(0, 80);
}

function buildReportSqlAndReplacements(querySql, inputs, params) {
  const inputMap = new Map();
  for (const f of inputs) {
    inputMap.set(reportCanonicalToken(f.key), f);
    inputMap.set(reportCanonicalToken(f.label), f);
  }
  const values = params && typeof params === 'object' ? params : {};
  const replacements = [];

  const sql = String(querySql).replace(/\{([^}]+)\}/g, (full, tokenRaw) => {
    const token = reportCanonicalToken(tokenRaw);
    const field = inputMap.get(token);
    if (!field) throw new Error(`Unknown query placeholder: {${String(tokenRaw).trim()}}`);
    const rawValue = values[field.key];

    if (REPORT_MULTI_VALUE_TYPES.has(field.type)) {
      const arr = Array.isArray(rawValue)
        ? rawValue.map((v) => String(v || '').trim()).filter(Boolean)
        : String(rawValue || '').trim()
          ? [String(rawValue || '').trim()]
          : [];
      if (field.required && arr.length === 0) {
        throw new Error(`Input "${field.label}" is required`);
      }
      if (arr.length === 0) return 'NULL';
      for (const one of arr) replacements.push(one);
      return arr.map(() => '?').join(', ');
    }

    const val = rawValue == null ? '' : String(rawValue).trim();
    if (field.required && !val) {
      throw new Error(`Input "${field.label}" is required`);
    }
    replacements.push(val || null);
    return '?';
  });

  return { sql, replacements };
}

async function ensureReportTableExists() {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS cms_reports (
      report_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(160) NOT NULL,
      slug VARCHAR(180) NOT NULL,
      report_type VARCHAR(24) NOT NULL DEFAULT 'list',
      title_input_key VARCHAR(80) NULL,
      inputs_json LONGTEXT NOT NULL,
      image_columns_json LONGTEXT NULL,
      query_sql LONGTEXT NOT NULL,
      show_on_dashboard TINYINT(1) NOT NULL DEFAULT 1,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (report_id),
      UNIQUE KEY uk_cms_reports_slug (slug)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
}

const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const uploadMicroserviceBase = (
  process.env.UPLOAD_MICROSERVICE_URL || 'http://109.106.244.241:9007'
).replace(/\/$/, '');

const MAX_FETCH_IMAGE_BYTES = 15 * 1024 * 1024;

/** Pool connections — faster for repeated imports than a cold socket each time. */
const imageImportHttpAgent = new http.Agent({ keepAlive: true, maxSockets: 50 });
const imageImportHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50 });

/**
 * CDNs often throttle or slow the default axios User-Agent. Browsers work because they send a real Chrome UA.
 * Override with IMAGE_IMPORT_USER_AGENT if needed.
 */
const IMAGE_IMPORT_USER_AGENT =
  process.env.IMAGE_IMPORT_USER_AGENT?.trim() ||
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const IMAGE_IMPORT_TIMEOUT_MS = Math.min(
  Math.max(parseInt(process.env.IMAGE_IMPORT_TIMEOUT_MS || '45000', 10) || 45000, 3000),
  120000
);

function assertFetchableImageUrl(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) throw new Error('URL is required');
  let u;
  try {
    u = new URL(trimmed);
  } catch {
    throw new Error('Invalid URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Only http and https URLs are allowed');
  }
  const host = u.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '0.0.0.0' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === '[::1]'
  ) {
    throw new Error('That URL is not allowed');
  }
  return u.toString();
}

function sniffImageMime(buf) {
  if (!buf || buf.length < 12) return null;
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

/**
 * Download a remote image for CMS "paste URL" import (POST /import/image-from-url).
 * Path avoids clashing with auto-mounted CRUD (e.g. a table slug /fetch-image-from-url).
 */
router.post('/import/image-from-url', async (req, res) => {
  try {
    const href = assertFetchableImageUrl(req.body?.url);
    const response = await axios.get(href, {
      responseType: 'arraybuffer',
      timeout: IMAGE_IMPORT_TIMEOUT_MS,
      maxContentLength: MAX_FETCH_IMAGE_BYTES,
      maxBodyLength: MAX_FETCH_IMAGE_BYTES,
      validateStatus: (s) => s >= 200 && s < 300,
      httpAgent: imageImportHttpAgent,
      httpsAgent: imageImportHttpsAgent,
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'User-Agent': IMAGE_IMPORT_USER_AGENT,
        'Accept-Language': 'en-US,en;q=0.9',
      },
      /** Avoid rare CDN/TLS issues with HTTP/2 from Node; axios uses HTTP/1.1 for this path. */
      maxRedirects: 5,
      decompress: true,
    });
    const buf = Buffer.from(response.data);
    if (buf.length === 0) {
      return res.status(400).json({ success: false, error: 'Empty response from URL' });
    }
    if (buf.length > MAX_FETCH_IMAGE_BYTES) {
      return res.status(400).json({ success: false, error: 'Image is too large' });
    }
    const headerCt = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const sniffed = sniffImageMime(buf);
    const contentType =
      headerCt && headerCt.startsWith('image/') ? headerCt : sniffed || null;
    if (!contentType || !contentType.startsWith('image/')) {
      return res.status(400).json({
        success: false,
        error: 'URL did not return a recognizable image (jpeg, png, gif, or webp)',
      });
    }
    const ext =
      contentType === 'image/png'
        ? 'png'
        : contentType === 'image/gif'
          ? 'gif'
          : contentType === 'image/webp'
            ? 'webp'
            : 'jpg';
    const base64 = buf.toString('base64');
    return res.json({
      success: true,
      data: {
        base64,
        contentType,
        suggestedFileName: `from-url-${Date.now()}.${ext}`,
      },
    });
  } catch (err) {
    const status = err.response?.status;
    if (status === 404) {
      return res.status(400).json({ success: false, error: 'Image not found (404)' });
    }
    const msg =
      err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN'
        ? 'Could not resolve host'
        : err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED'
          ? 'Request timed out'
          : err.message || 'Failed to download image';
    return res.status(400).json({ success: false, error: msg });
  }
});

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
      await assertProductRequiredFieldsOnWrite(table, idCol, body, null);
      const keys = cols.filter((c) => body[c] !== undefined);
      if (keys.length === 0) {
        return res.status(400).json({ success: false, error: 'No valid fields to insert' });
      }
      if (keys.includes('slug')) {
        await assertSlugUnique(table, cols, idCol, body.slug, null);
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
      await assertProductRequiredFieldsOnWrite(table, idCol, body, req.params.id);
      const keys = cols.filter((c) => body[c] !== undefined && c !== idCol);
      if (keys.length === 0) {
        const [row] = await sequelize.query(
          `SELECT * FROM \`${table}\` WHERE \`${idCol}\` = :pkId`,
          { type: QueryTypes.SELECT, replacements: { pkId: req.params.id } }
        );
        return res.json({ success: true, data: row });
      }
      if (keys.includes('slug')) {
        await assertSlugUnique(table, cols, idCol, body.slug, req.params.id);
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
      if (cols.includes('is_deleted')) {
        const [existing] = await sequelize.query(
          `SELECT \`is_deleted\` FROM \`${table}\` WHERE \`${idCol}\` = :pkId`,
          { type: QueryTypes.SELECT, replacements: { pkId: req.params.id } }
        );
        if (!existing) {
          return res.status(404).json({ success: false, error: 'Not found' });
        }
        const del = existing.is_deleted;
        const currentlyDeleted =
          del === 1 || del === true || String(del) === '1' || Number(del) === 1;
        const nextFlag = currentlyDeleted ? 0 : 1;
        const setParts = ['`is_deleted` = :nextFlag'];
        if (cols.includes('updated_at')) {
          setParts.push('`updated_at` = CURRENT_TIMESTAMP');
        }
        const [r] = await sequelize.query(
          `UPDATE \`${table}\` SET ${setParts.join(', ')} WHERE \`${idCol}\` = :pkId`,
          { replacements: { nextFlag, pkId: req.params.id } }
        );
        if (r.affectedRows === 0) {
          return res.status(404).json({ success: false, error: 'Not found' });
        }
        const [row] = await sequelize.query(
          `SELECT * FROM \`${table}\` WHERE \`${idCol}\` = :pkId`,
          { type: QueryTypes.SELECT, replacements: { pkId: req.params.id } }
        );
        return res.json({
          success: true,
          soft: true,
          restored: currentlyDeleted,
          deleted: !currentlyDeleted,
          data: row,
        });
      }
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
 * Attach nested `brand` + `categories[]` to plain product row(s) from `products`.
 */
/** Whitelisted ORDER BY for GET /products (avoids raw orderBy injection). */
const PRODUCT_LIST_SORT_SQL = {
  product_name: 'p.product_name',
  image_updated_at: 'p.image_updated_at',
  unit: 'p.unit',
  brand: 'b.name',
  old_price: 'p.old_price',
  price: 'p.price',
  stock_quantity: 'p.stock_quantity',
  minimum_qty: 'p.minimum_qty',
};

function productListOrderClause(query) {
  const sort = String(query.sort || '').trim().toLowerCase();
  const orderRaw = String(query.order || 'asc').trim().toLowerCase();
  const dir = orderRaw === 'desc' ? 'DESC' : 'ASC';
  const col = PRODUCT_LIST_SORT_SQL[sort];
  if (!col) return ' ORDER BY p.product_id ASC';
  return ` ORDER BY ${col} ${dir}, p.product_id ASC`;
}

const PRODUCT_SEARCH_MAX_TOKENS = 8;
const PRODUCT_SEARCH_MAX_TOKEN_LEN = 64;

/** Escape LIKE wildcards in user tokens (MySQL default escape \). */
function escapeSqlLikeFragment(str) {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

/**
 * q / search: whitespace = AND of tokens; each token matches if ANY column matches (LIKE %token%).
 * All values are bound — no string concatenation of user input into SQL.
 * @returns {{ sql: string, replacements: any[] }}
 */
function buildProductSearchClause(rawQuery) {
  const raw = String(rawQuery ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!raw) return { sql: '', replacements: [] };

  const tokens = raw
    .split(' ')
    .map((t) => t.slice(0, PRODUCT_SEARCH_MAX_TOKEN_LEN))
    .filter((t) => t.length > 0)
    .slice(0, PRODUCT_SEARCH_MAX_TOKENS);

  if (tokens.length === 0) return { sql: '', replacements: [] };

  const orCols = [
    'p.product_name',
    'p.sku',
    'p.slug',
    'p.unit',
    'p.parent_sku',
    'CAST(p.product_id AS CHAR)',
    'CAST(p.brand_id AS CHAR)',
    'CAST(p.price AS CHAR)',
    'CAST(p.old_price AS CHAR)',
    'CAST(p.cost_price AS CHAR)',
    'CAST(p.stock_quantity AS CHAR)',
    'b.name',
    'b.slug',
    'p.product_description',
  ];

  const replacements = [];
  const andGroups = [];

  for (const token of tokens) {
    const pat = `%${escapeSqlLikeFragment(token)}%`;
    const orParts = orCols.map((col) => `${col} LIKE ?`);
    andGroups.push(`(${orParts.join(' OR ')})`);
    for (let i = 0; i < orCols.length; i += 1) {
      replacements.push(pat);
    }
  }

  return { sql: andGroups.join(' AND '), replacements };
}

async function categoriesByProductIds(productIds) {
  const ids = [...new Set((productIds || []).map((x) => Number(x)).filter((n) => !Number.isNaN(n)))];
  if (!ids.length) return new Map();
  const ph = ids.map(() => '?').join(',');
  const rows = await sequelize.query(
    `SELECT pc.product_id, c.category_id, c.category_name, c.slug, c.image, pc.position
     FROM product_categories pc
     INNER JOIN categories c ON c.category_id = pc.category_id
     WHERE pc.product_id IN (${ph})
     ORDER BY pc.product_id, pc.position ASC, c.category_name ASC`,
    { type: QueryTypes.SELECT, replacements: ids }
  );
  const map = new Map();
  for (const row of rows) {
    const pid = Number(row.product_id);
    if (!map.has(pid)) map.set(pid, []);
    map.get(pid).push({
      category_id: row.category_id,
      category_name: row.category_name,
      slug: row.slug,
      image: row.image,
    });
  }
  return map;
}

async function tagsByProductIds(productIds) {
  const ids = [...new Set((productIds || []).map((x) => Number(x)).filter((n) => !Number.isNaN(n)))];
  if (!ids.length) return new Map();
  const ph = ids.map(() => '?').join(',');
  const rows = await sequelize.query(
    `SELECT pt.product_id, t.id AS tag_id, t.name
     FROM \`product_tags\` pt
     INNER JOIN \`tags\` t ON t.id = pt.tag_id
     WHERE pt.product_id IN (${ph})
     ORDER BY pt.product_id, t.name ASC`,
    { type: QueryTypes.SELECT, replacements: ids }
  );
  const map = new Map();
  for (const row of rows) {
    const pid = Number(row.product_id);
    if (!map.has(pid)) map.set(pid, []);
    map.get(pid).push({
      id: row.tag_id,
      name: row.name,
    });
  }
  return map;
}

function shapeProductRow(p, catMap, tagMap) {
  const { _brand_name: brandName, _brand_slug: brandSlug, _brand_image: brandImage, ...rest } = p;
  const brand =
    rest.brand_id != null
      ? {
          id: rest.brand_id,
          name: brandName ?? null,
          slug: brandSlug ?? null,
          image: brandImage ?? null,
        }
      : null;
  const pid = Number(rest.product_id);
  return {
    ...rest,
    brand,
    categories: catMap.get(pid) || [],
    tags: tagMap.get(pid) || [],
  };
}

async function productsListEnriched(req, res) {
  try {
    const limitRaw = req.query.limit != null ? parseInt(req.query.limit, 10) : 20;
    const offsetRaw = req.query.offset != null ? parseInt(req.query.offset, 10) : 0;
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 20;
    const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;
    const searchRaw = req.query.q != null ? req.query.q : req.query.search;
    const { sql: searchSql, replacements: searchReps } = buildProductSearchClause(searchRaw);
    const legacyWhere = req.query.where ? String(req.query.where).trim() : '';

    let whereSql = '';
    if (legacyWhere && searchSql) {
      whereSql = ` WHERE (${legacyWhere}) AND (${searchSql})`;
    } else if (legacyWhere) {
      whereSql = ` WHERE (${legacyWhere})`;
    } else if (searchSql) {
      whereSql = ` WHERE ${searchSql}`;
    }

    const order = productListOrderClause(req.query);
    const fromJoin = 'FROM products p LEFT JOIN brand b ON b.id = p.brand_id';

    const rows = await sequelize.query(
      `SELECT p.*, b.name AS _brand_name, b.slug AS _brand_slug, b.image AS _brand_image
       ${fromJoin}
       ${whereSql}${order}
       LIMIT ? OFFSET ?`,
      { type: QueryTypes.SELECT, replacements: [...searchReps, limit, offset] }
    );
    const [countRow] = await sequelize.query(
      `SELECT COUNT(DISTINCT p.product_id) AS c ${fromJoin} ${whereSql}`,
      { type: QueryTypes.SELECT, replacements: [...searchReps] }
    );
    const pids = rows.map((r) => r.product_id);
    const [catMap, tagMap] = await Promise.all([
      categoriesByProductIds(pids),
      tagsByProductIds(pids),
    ]);
    const data = rows.map((row) => shapeProductRow(row, catMap, tagMap));
    res.json({ success: true, data, total: countRow?.c ?? 0 });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

async function productsGetEnriched(req, res) {
  try {
    const [row] = await sequelize.query(
      `SELECT p.*, b.name AS _brand_name, b.slug AS _brand_slug, b.image AS _brand_image
       FROM products p
       LEFT JOIN brand b ON b.id = p.brand_id
       WHERE p.product_id = :pkId`,
      { type: QueryTypes.SELECT, replacements: { pkId: req.params.id } }
    );
    if (!row) return res.status(404).json({ success: false, error: 'Not found' });
    const pid = row.product_id;
    const [catMap, tagMap] = await Promise.all([
      categoriesByProductIds([pid]),
      tagsByProductIds([pid]),
    ]);
    res.json({ success: true, data: shapeProductRow(row, catMap, tagMap) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/v1/admin/products/by-sku?sku=...
 * Same enriched shape as GET /products/:id — used to copy fields from another product in the CMS.
 * Registered before /products/:id so "by-sku" is not captured as an id.
 */
async function productsLookupBySku(req, res) {
  const sku = String(req.query.sku ?? '').trim();
  if (!sku) {
    return res.status(400).json({ success: false, error: 'Missing sku query parameter' });
  }
  try {
    const rows = await sequelize.query(
      `SELECT p.*, b.name AS _brand_name, b.slug AS _brand_slug, b.image AS _brand_image
       FROM products p
       LEFT JOIN brand b ON b.id = p.brand_id
       WHERE p.sku = :sku
       LIMIT 2`,
      { type: QueryTypes.SELECT, replacements: { sku } }
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'No product with this SKU' });
    }
    if (rows.length > 1) {
      return res.status(409).json({
        success: false,
        error: 'Multiple products share this SKU; fix duplicates in the database first.',
      });
    }
    const row = rows[0];
    const pid = row.product_id;
    const [catMap, tagMap] = await Promise.all([
      categoriesByProductIds([pid]),
      tagsByProductIds([pid]),
    ]);
    res.json({ success: true, data: shapeProductRow(row, catMap, tagMap) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

function mountProducts(path, table, cols, idCol) {
  const a = api(table, cols, idCol);
  router.get(path, productsListEnriched);
  router.get(`${path}/by-sku`, productsLookupBySku);
  router.get(`${path}/:id`, productsGetEnriched);
  router.post(path, a.create);
  router.put(`${path}/:id`, a.update);
  router.delete(`${path}/:id`, a.delete);
}

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

/**
 * Product ↔ categories (junction). GET list for editor; PUT replaces all links for a product.
 * Registered before generic CRUD /products/:id. If clients get 404 here, the API process needs a
 * restart (stale server) — a live handler always returns { success: true, data: [...] } (possibly empty).
 */
router.get('/products/:productId/category-links', async (req, res) => {
  try {
    const productId = parseInt(req.params.productId, 10);
    if (Number.isNaN(productId)) {
      return res.status(400).json({ success: false, error: 'Invalid product id' });
    }
    const rows = await sequelize.query(
      `SELECT pc.category_id, c.category_name, c.slug, c.image
       FROM product_categories pc
       INNER JOIN categories c ON c.category_id = pc.category_id
       WHERE pc.product_id = :productId
       ORDER BY pc.position ASC, c.category_name ASC`,
      { type: QueryTypes.SELECT, replacements: { productId } }
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/products/:productId/category-links', async (req, res) => {
  const productId = parseInt(req.params.productId, 10);
  if (Number.isNaN(productId)) {
    return res.status(400).json({ success: false, error: 'Invalid product id' });
  }
  const raw = req.body?.category_ids;
  const categoryIds = Array.isArray(raw)
    ? [...new Set(raw.map((x) => parseInt(x, 10)).filter((n) => !Number.isNaN(n)))]
    : [];
  let t = null;
  try {
    t = await sequelize.transaction();
    await sequelize.query(`DELETE FROM product_categories WHERE product_id = :productId`, {
      transaction: t,
      replacements: { productId },
    });
    for (let i = 0; i < categoryIds.length; i += 1) {
      await sequelize.query(
        `INSERT INTO product_categories (category_id, product_id, position) VALUES (:cid, :pid, :pos)`,
        { transaction: t, replacements: { cid: categoryIds[i], pid: productId, pos: i + 1 } }
      );
    }
    await t.commit();
    t = null;
    res.json({ success: true });
  } catch (err) {
    if (t) await t.rollback();
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Append one category to a product (does not remove existing links). Idempotent if already linked.
 * POST /api/v1/admin/products/:productId/category-links/append
 * Body: { category_id: number }
 */
router.post('/products/:productId/category-links/append', async (req, res) => {
  const productId = parseInt(req.params.productId, 10);
  const categoryId = parseInt(req.body?.category_id, 10);
  if (Number.isNaN(productId) || Number.isNaN(categoryId)) {
    return res.status(400).json({ success: false, error: 'Invalid product_id or category_id' });
  }
  try {
    const [exists] = await sequelize.query(
      `SELECT 1 as ok FROM product_categories WHERE product_id = :productId AND category_id = :categoryId LIMIT 1`,
      { type: QueryTypes.SELECT, replacements: { productId, categoryId } }
    );
    if (exists) {
      const rows = await sequelize.query(
        `SELECT category_id FROM product_categories WHERE product_id = :productId ORDER BY position ASC`,
        { type: QueryTypes.SELECT, replacements: { productId } }
      );
      const category_ids = rows.map((r) => r.category_id);
      return res.json({ success: true, data: { appended: false, category_ids } });
    }
    const [maxRow] = await sequelize.query(
      `SELECT COALESCE(MAX(position), 0) as m FROM product_categories WHERE product_id = :productId`,
      { type: QueryTypes.SELECT, replacements: { productId } }
    );
    const pos = (maxRow?.m != null ? Number(maxRow.m) : 0) + 1;
    await sequelize.query(
      `INSERT INTO product_categories (category_id, product_id, position) VALUES (:cid, :pid, :pos)`,
      { replacements: { cid: categoryId, pid: productId, pos } }
    );
    const rows = await sequelize.query(
      `SELECT category_id FROM product_categories WHERE product_id = :productId ORDER BY position ASC`,
      { type: QueryTypes.SELECT, replacements: { productId } }
    );
    const category_ids = rows.map((r) => r.category_id);
    res.json({ success: true, data: { appended: true, category_ids } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Product ↔ tags (junction table product_tags). GET for editor; PUT replaces all links.
 */
router.get('/products/:productId/tag-links', async (req, res) => {
  try {
    const productId = parseInt(req.params.productId, 10);
    if (Number.isNaN(productId)) {
      return res.status(400).json({ success: false, error: 'Invalid product id' });
    }
    const rows = await sequelize.query(
      `SELECT t.id, t.name
       FROM \`product_tags\` pt
       INNER JOIN \`tags\` t ON t.id = pt.tag_id
       WHERE pt.product_id = :productId
       ORDER BY t.name ASC`,
      { type: QueryTypes.SELECT, replacements: { productId } }
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/products/:productId/tag-links', async (req, res) => {
  const productId = parseInt(req.params.productId, 10);
  if (Number.isNaN(productId)) {
    return res.status(400).json({ success: false, error: 'Invalid product id' });
  }
  const raw = req.body?.tag_ids;
  const tagIds = Array.isArray(raw)
    ? [...new Set(raw.map((x) => parseInt(x, 10)).filter((n) => !Number.isNaN(n)))]
    : [];
  let t = null;
  try {
    t = await sequelize.transaction();
    await sequelize.query(`DELETE FROM \`product_tags\` WHERE product_id = :productId`, {
      transaction: t,
      replacements: { productId },
    });
    for (let i = 0; i < tagIds.length; i += 1) {
      await sequelize.query(
        `INSERT INTO \`product_tags\` (product_id, tag_id, created_at) VALUES (:pid, :tid, NOW())`,
        { transaction: t, replacements: { pid: productId, tid: tagIds[i] } }
      );
    }
    await t.commit();
    t = null;
    res.json({ success: true });
  } catch (err) {
    if (t) await t.rollback();
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Append one tag to a product (does not remove existing links). Idempotent if already linked.
 * POST /api/v1/admin/products/:productId/tag-links/append
 * Body: { tag_id: number }
 */
router.post('/products/:productId/tag-links/append', async (req, res) => {
  const productId = parseInt(req.params.productId, 10);
  const tagId = parseInt(req.body?.tag_id, 10);
  if (Number.isNaN(productId) || Number.isNaN(tagId)) {
    return res.status(400).json({ success: false, error: 'Invalid product_id or tag_id' });
  }
  try {
    const [exists] = await sequelize.query(
      `SELECT 1 as ok FROM product_tags WHERE product_id = :productId AND tag_id = :tagId LIMIT 1`,
      { type: QueryTypes.SELECT, replacements: { productId, tagId } }
    );
    if (exists) {
      const rows = await sequelize.query(
        `SELECT tag_id FROM product_tags WHERE product_id = :productId ORDER BY tag_id ASC`,
        { type: QueryTypes.SELECT, replacements: { productId } }
      );
      const tag_ids = rows.map((r) => r.tag_id);
      return res.json({ success: true, data: { appended: false, tag_ids } });
    }
    await sequelize.query(
      `INSERT INTO product_tags (product_id, tag_id, created_at) VALUES (:pid, :tid, NOW())`,
      { replacements: { pid: productId, tid: tagId } }
    );
    const rows = await sequelize.query(
      `SELECT tag_id FROM product_tags WHERE product_id = :productId ORDER BY tag_id ASC`,
      { type: QueryTypes.SELECT, replacements: { productId } }
    );
    const tag_ids = rows.map((r) => r.tag_id);
    res.json({ success: true, data: { appended: true, tag_ids } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Update only product `image` and/or `thumb_image` (no other columns).
 * PATCH /api/v1/admin/products/:productId/images
 * Body (JSON): at least one of:
 *   - image: string | null — main image URL/path (empty string → null)
 *   - thumb_image: string | null
 *   - thumb: string | null — alias for thumb_image (if both sent, thumb_image wins)
 * Omitted keys are left unchanged.
 */
function normalizeNullableUrlField(v) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/**
 * AI: extract product fields + match categories/tags/brands from a product photo (Gemini vision).
 * Body: { imageUrl?: string, imageBase64?: string, mimeType?: string }
 */
router.post('/ai/product/extract-from-image', async (req, res) => {
  try {
    if (!process.env.GOOGLE_API_KEY) {
      return res.status(503).json({
        success: false,
        error: 'GOOGLE_API_KEY is not set. Add it to grocery-cms-api .env (Google AI Studio key).',
      });
    }
    let buf;
    let mime = (req.body && req.body.mimeType) || 'image/jpeg';

    if (req.body?.imageBase64) {
      buf = Buffer.from(String(req.body.imageBase64), 'base64');
      if (!buf.length) {
        return res.status(400).json({ success: false, error: 'imageBase64 is empty' });
      }
      const sniffed = sniffImageMime(buf);
      if (sniffed) mime = sniffed;
    } else if (req.body?.imageUrl) {
      const href = assertFetchableImageUrl(req.body.imageUrl);
      const response = await axios.get(href, {
        responseType: 'arraybuffer',
        timeout: IMAGE_IMPORT_TIMEOUT_MS,
        maxContentLength: MAX_FETCH_IMAGE_BYTES,
        maxBodyLength: MAX_FETCH_IMAGE_BYTES,
        validateStatus: (s) => s >= 200 && s < 300,
        httpAgent: imageImportHttpAgent,
        httpsAgent: imageImportHttpsAgent,
        headers: {
          Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          'User-Agent': IMAGE_IMPORT_USER_AGENT,
        },
        maxRedirects: 5,
        decompress: true,
      });
      buf = Buffer.from(response.data);
      const headerCt = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const sniffed = sniffImageMime(buf);
      mime =
        headerCt && headerCt.startsWith('image/') ? headerCt : sniffed || 'image/jpeg';
      if (!mime.startsWith('image/')) {
        return res.status(400).json({ success: false, error: 'URL did not return an image' });
      }
    } else {
      return res.status(400).json({
        success: false,
        error: 'Provide imageUrl or imageBase64 (product photo)',
      });
    }

    if (buf.length > MAX_FETCH_IMAGE_BYTES) {
      return res.status(400).json({ success: false, error: 'Image is too large' });
    }

    const data = await geminiProductAi.extractProductFromImage(buf, mime);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || 'AI extract failed' });
  }
});

/**
 * AI: generate a clean white-background 512-friendly listing image from the source photo (Gemini image model).
 * Body: { imageUrl?: string, imageBase64?: string, mimeType?: string }
 */
router.post('/ai/product/generate-listing-image', async (req, res) => {
  try {
    if (!process.env.GOOGLE_API_KEY) {
      return res.status(503).json({
        success: false,
        error: 'GOOGLE_API_KEY is not set.',
      });
    }
    let buf;
    let mime = (req.body && req.body.mimeType) || 'image/jpeg';

    if (req.body?.imageBase64) {
      buf = Buffer.from(String(req.body.imageBase64), 'base64');
      if (!buf.length) {
        return res.status(400).json({ success: false, error: 'imageBase64 is empty' });
      }
      const sniffed = sniffImageMime(buf);
      if (sniffed) mime = sniffed;
    } else if (req.body?.imageUrl) {
      const href = assertFetchableImageUrl(req.body.imageUrl);
      const response = await axios.get(href, {
        responseType: 'arraybuffer',
        timeout: IMAGE_IMPORT_TIMEOUT_MS,
        maxContentLength: MAX_FETCH_IMAGE_BYTES,
        maxBodyLength: MAX_FETCH_IMAGE_BYTES,
        validateStatus: (s) => s >= 200 && s < 300,
        httpAgent: imageImportHttpAgent,
        httpsAgent: imageImportHttpsAgent,
        headers: {
          Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          'User-Agent': IMAGE_IMPORT_USER_AGENT,
        },
        maxRedirects: 5,
        decompress: true,
      });
      buf = Buffer.from(response.data);
      const headerCt = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const sniffed = sniffImageMime(buf);
      mime =
        headerCt && headerCt.startsWith('image/') ? headerCt : sniffed || 'image/jpeg';
      if (!mime.startsWith('image/')) {
        return res.status(400).json({ success: false, error: 'URL did not return an image' });
      }
    } else {
      return res.status(400).json({
        success: false,
        error: 'Provide imageUrl or imageBase64',
      });
    }

    if (buf.length > MAX_FETCH_IMAGE_BYTES) {
      return res.status(400).json({ success: false, error: 'Image is too large' });
    }

    const out = await geminiProductAi.generateListingImage(buf, mime);
    res.json({
      success: true,
      data: {
        imageBase64: out.base64,
        mimeType: out.mimeType,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || 'Image generation failed' });
  }
});

router.patch('/products/:productId/images', async (req, res) => {
  try {
    const productId = parseInt(req.params.productId, 10);
    if (Number.isNaN(productId)) {
      return res.status(400).json({ success: false, error: 'Invalid product id' });
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const image = normalizeNullableUrlField(body.image);
    const thumbFromBody =
      body.thumb_image !== undefined ? body.thumb_image : body.thumb;
    const thumb_image = normalizeNullableUrlField(thumbFromBody);

    if (image === undefined && thumb_image === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Provide at least one of: image, thumb_image, thumb',
      });
    }

    const sets = [];
    const replacements = { productId };
    if (image !== undefined) {
      sets.push('`image` = :image');
      replacements.image = image;
    }
    if (thumb_image !== undefined) {
      sets.push('`thumb_image` = :thumb_image');
      replacements.thumb_image = thumb_image;
    }

    const [meta] = await sequelize.query(
      `UPDATE products SET ${sets.join(', ')} WHERE product_id = :productId`,
      { replacements }
    );

    const affected = meta && typeof meta.affectedRows === 'number' ? meta.affectedRows : 0;
    if (affected === 0) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    const [row] = await sequelize.query(
      `SELECT product_id, image, thumb_image, image_updated_at FROM products WHERE product_id = :productId`,
      { type: QueryTypes.SELECT, replacements: { productId } }
    );

    res.json({
      success: true,
      data: {
        product_id: row.product_id,
        image: row.image ?? null,
        thumb_image: row.thumb_image ?? null,
        image_updated_at: row.image_updated_at ?? null,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Reports builder + runner (read-only SQL templates with parameter placeholders).
 */
router.get('/reports', async (req, res) => {
  try {
    await ensureReportTableExists();
    const rows = await sequelize.query(
      `SELECT report_id, name, slug, report_type, title_input_key, inputs_json, image_columns_json,
              query_sql, show_on_dashboard, is_active, created_at, updated_at
       FROM cms_reports
       ORDER BY updated_at DESC, report_id DESC`,
      { type: QueryTypes.SELECT }
    );
    const data = rows.map((r) => ({
      ...r,
      inputs: (() => {
        try {
          return JSON.parse(r.inputs_json || '[]');
        } catch {
          return [];
        }
      })(),
      image_columns: (() => {
        try {
          return JSON.parse(r.image_columns_json || '[]');
        } catch {
          return [];
        }
      })(),
    }));
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/reports/dashboard', async (req, res) => {
  try {
    await ensureReportTableExists();
    const rows = await sequelize.query(
      `SELECT report_id, name, slug, report_type, title_input_key, inputs_json, image_columns_json
       FROM cms_reports
       WHERE is_active = 1 AND show_on_dashboard = 1
       ORDER BY updated_at DESC, report_id DESC`,
      { type: QueryTypes.SELECT }
    );
    const data = rows.map((r) => ({
      ...r,
      inputs: (() => {
        try {
          return JSON.parse(r.inputs_json || '[]');
        } catch {
          return [];
        }
      })(),
      image_columns: (() => {
        try {
          return JSON.parse(r.image_columns_json || '[]');
        } catch {
          return [];
        }
      })(),
    }));
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/reports/slug/:slug', async (req, res) => {
  try {
    await ensureReportTableExists();
    const slug = String(req.params.slug || '').trim().toLowerCase();
    if (!slug) return res.status(400).json({ success: false, error: 'Invalid report slug' });
    const [row] = await sequelize.query(
      `SELECT report_id, name, slug, report_type, title_input_key, inputs_json, image_columns_json,
              query_sql, show_on_dashboard, is_active, created_at, updated_at
       FROM cms_reports
       WHERE slug = :slug
       LIMIT 1`,
      { type: QueryTypes.SELECT, replacements: { slug } }
    );
    if (!row) return res.status(404).json({ success: false, error: 'Report not found' });
    res.json({
      success: true,
      data: {
        ...row,
        inputs: (() => {
          try {
            return JSON.parse(row.inputs_json || '[]');
          } catch {
            return [];
          }
        })(),
        image_columns: (() => {
          try {
            return JSON.parse(row.image_columns_json || '[]');
          } catch {
            return [];
          }
        })(),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/reports/:reportId', async (req, res) => {
  try {
    await ensureReportTableExists();
    const reportId = parseInt(req.params.reportId, 10);
    if (Number.isNaN(reportId)) {
      return res.status(400).json({ success: false, error: 'Invalid report id' });
    }
    const [row] = await sequelize.query(
      `SELECT report_id, name, slug, report_type, title_input_key, inputs_json, image_columns_json,
              query_sql, show_on_dashboard, is_active, created_at, updated_at
       FROM cms_reports
       WHERE report_id = :reportId
       LIMIT 1`,
      { type: QueryTypes.SELECT, replacements: { reportId } }
    );
    if (!row) return res.status(404).json({ success: false, error: 'Report not found' });
    res.json({
      success: true,
      data: {
        ...row,
        inputs: (() => {
          try {
            return JSON.parse(row.inputs_json || '[]');
          } catch {
            return [];
          }
        })(),
        image_columns: (() => {
          try {
            return JSON.parse(row.image_columns_json || '[]');
          } catch {
            return [];
          }
        })(),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/reports', async (req, res) => {
  try {
    await ensureReportTableExists();
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const name = String(body.name || '').trim().slice(0, 160);
    if (!name) return res.status(400).json({ success: false, error: 'Report name is required' });
    const slug = reportSlugify(body.slug || name);
    if (!slug) return res.status(400).json({ success: false, error: 'Report slug is required' });
    const reportType = String(body.report_type || 'list').trim().toLowerCase();
    const normalizedType = REPORT_OUTPUT_TYPES.has(reportType) ? reportType : 'list';
    const inputs = parseReportInputFields(body.inputs);
    const titleInputKey = reportKeyify(body.title_input_key || '');
    if (titleInputKey && !inputs.some((x) => x.key === titleInputKey)) {
      return res.status(400).json({ success: false, error: 'Title input must match one input field key' });
    }
    const querySql = normalizeReadOnlySelectSql(body.query_sql);
    const imageColumns = parseImageColumns(body.image_columns);
    const showOnDashboard = body.show_on_dashboard === false || body.show_on_dashboard === 0 || body.show_on_dashboard === '0' ? 0 : 1;
    const isActive = body.is_active === false || body.is_active === 0 || body.is_active === '0' ? 0 : 1;

    await sequelize.query(
      `INSERT INTO cms_reports
       (name, slug, report_type, title_input_key, inputs_json, image_columns_json, query_sql, show_on_dashboard, is_active)
       VALUES (:name, :slug, :reportType, :titleInputKey, :inputsJson, :imageColsJson, :querySql, :showOnDashboard, :isActive)`,
      {
        replacements: {
          name,
          slug,
          reportType: normalizedType,
          titleInputKey: titleInputKey || null,
          inputsJson: JSON.stringify(inputs),
          imageColsJson: JSON.stringify(imageColumns),
          querySql,
          showOnDashboard,
          isActive,
        },
      }
    );
    const [lastRow] = await sequelize.query('SELECT LAST_INSERT_ID() AS id', { type: QueryTypes.SELECT });
    const [row] = await sequelize.query(
      `SELECT report_id, name, slug, report_type, title_input_key, inputs_json, image_columns_json,
              query_sql, show_on_dashboard, is_active, created_at, updated_at
       FROM cms_reports
       WHERE report_id = :reportId`,
      { type: QueryTypes.SELECT, replacements: { reportId: lastRow?.id } }
    );
    res.status(201).json({
      success: true,
      data: {
        ...row,
        inputs,
        image_columns: imageColumns,
      },
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      return res.status(409).json({ success: false, error: 'Report slug already exists' });
    }
    res.status(400).json({ success: false, error: err.message });
  }
});

router.put('/reports/:reportId', async (req, res) => {
  try {
    await ensureReportTableExists();
    const reportId = parseInt(req.params.reportId, 10);
    if (Number.isNaN(reportId)) {
      return res.status(400).json({ success: false, error: 'Invalid report id' });
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const name = String(body.name || '').trim().slice(0, 160);
    if (!name) return res.status(400).json({ success: false, error: 'Report name is required' });
    const slug = reportSlugify(body.slug || name);
    if (!slug) return res.status(400).json({ success: false, error: 'Report slug is required' });
    const reportType = String(body.report_type || 'list').trim().toLowerCase();
    const normalizedType = REPORT_OUTPUT_TYPES.has(reportType) ? reportType : 'list';
    const inputs = parseReportInputFields(body.inputs);
    const titleInputKey = reportKeyify(body.title_input_key || '');
    if (titleInputKey && !inputs.some((x) => x.key === titleInputKey)) {
      return res.status(400).json({ success: false, error: 'Title input must match one input field key' });
    }
    const querySql = normalizeReadOnlySelectSql(body.query_sql);
    const imageColumns = parseImageColumns(body.image_columns);
    const showOnDashboard = body.show_on_dashboard === false || body.show_on_dashboard === 0 || body.show_on_dashboard === '0' ? 0 : 1;
    const isActive = body.is_active === false || body.is_active === 0 || body.is_active === '0' ? 0 : 1;

    const [meta] = await sequelize.query(
      `UPDATE cms_reports
       SET name = :name,
           slug = :slug,
           report_type = :reportType,
           title_input_key = :titleInputKey,
           inputs_json = :inputsJson,
           image_columns_json = :imageColsJson,
           query_sql = :querySql,
           show_on_dashboard = :showOnDashboard,
           is_active = :isActive
       WHERE report_id = :reportId`,
      {
        replacements: {
          reportId,
          name,
          slug,
          reportType: normalizedType,
          titleInputKey: titleInputKey || null,
          inputsJson: JSON.stringify(inputs),
          imageColsJson: JSON.stringify(imageColumns),
          querySql,
          showOnDashboard,
          isActive,
        },
      }
    );
    const affected = meta && typeof meta.affectedRows === 'number' ? meta.affectedRows : 0;
    if (!affected) return res.status(404).json({ success: false, error: 'Report not found' });

    const [row] = await sequelize.query(
      `SELECT report_id, name, slug, report_type, title_input_key, inputs_json, image_columns_json,
              query_sql, show_on_dashboard, is_active, created_at, updated_at
       FROM cms_reports
       WHERE report_id = :reportId`,
      { type: QueryTypes.SELECT, replacements: { reportId } }
    );
    res.json({
      success: true,
      data: {
        ...row,
        inputs,
        image_columns: imageColumns,
      },
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      return res.status(409).json({ success: false, error: 'Report slug already exists' });
    }
    res.status(400).json({ success: false, error: err.message });
  }
});

router.delete('/reports/:reportId', async (req, res) => {
  try {
    await ensureReportTableExists();
    const reportId = parseInt(req.params.reportId, 10);
    if (Number.isNaN(reportId)) return res.status(400).json({ success: false, error: 'Invalid report id' });
    const [meta] = await sequelize.query('DELETE FROM cms_reports WHERE report_id = :reportId', {
      replacements: { reportId },
    });
    const affected = meta && typeof meta.affectedRows === 'number' ? meta.affectedRows : 0;
    if (!affected) return res.status(404).json({ success: false, error: 'Report not found' });
    res.json({ success: true, deleted: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/reports/:reportId/run', async (req, res) => {
  try {
    await ensureReportTableExists();
    const reportId = parseInt(req.params.reportId, 10);
    if (Number.isNaN(reportId)) return res.status(400).json({ success: false, error: 'Invalid report id' });
    const [row] = await sequelize.query(
      `SELECT report_id, name, slug, report_type, title_input_key, inputs_json, image_columns_json, query_sql, is_active
       FROM cms_reports
       WHERE report_id = :reportId
       LIMIT 1`,
      { type: QueryTypes.SELECT, replacements: { reportId } }
    );
    if (!row) return res.status(404).json({ success: false, error: 'Report not found' });
    if (!(row.is_active === 1 || row.is_active === true || row.is_active === '1')) {
      return res.status(400).json({ success: false, error: 'Report is inactive' });
    }
    const inputs = (() => {
      try {
        return parseReportInputFields(JSON.parse(row.inputs_json || '[]'));
      } catch {
        return [];
      }
    })();
    const imageColumns = (() => {
      try {
        return parseImageColumns(JSON.parse(row.image_columns_json || '[]'));
      } catch {
        return [];
      }
    })();
    const templateSql = normalizeReadOnlySelectSql(row.query_sql);
    const params = req.body?.params && typeof req.body.params === 'object' ? req.body.params : {};
    const { sql, replacements } = buildReportSqlAndReplacements(templateSql, inputs, params);
    const safeSql = normalizeReadOnlySelectSql(sql);
    const rows = await sequelize.query(safeSql, { type: QueryTypes.SELECT, replacements });
    res.json({
      success: true,
      data: {
        report: {
          report_id: row.report_id,
          name: row.name,
          slug: row.slug,
          report_type: row.report_type,
          title_input_key: row.title_input_key,
          inputs,
          image_columns: imageColumns,
        },
        rows,
        rowCount: Array.isArray(rows) ? rows.length : 0,
      },
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/reports/slug/:slug/run', async (req, res) => {
  try {
    await ensureReportTableExists();
    const slug = String(req.params.slug || '').trim().toLowerCase();
    if (!slug) return res.status(400).json({ success: false, error: 'Invalid report slug' });
    const [row] = await sequelize.query(
      `SELECT report_id, name, slug, report_type, title_input_key, inputs_json, image_columns_json, query_sql, is_active
       FROM cms_reports
       WHERE slug = :slug
       LIMIT 1`,
      { type: QueryTypes.SELECT, replacements: { slug } }
    );
    if (!row) return res.status(404).json({ success: false, error: 'Report not found' });
    if (!(row.is_active === 1 || row.is_active === true || row.is_active === '1')) {
      return res.status(400).json({ success: false, error: 'Report is inactive' });
    }
    const inputs = (() => {
      try {
        return parseReportInputFields(JSON.parse(row.inputs_json || '[]'));
      } catch {
        return [];
      }
    })();
    const imageColumns = (() => {
      try {
        return parseImageColumns(JSON.parse(row.image_columns_json || '[]'));
      } catch {
        return [];
      }
    })();
    const templateSql = normalizeReadOnlySelectSql(row.query_sql);
    const params = req.body?.params && typeof req.body.params === 'object' ? req.body.params : {};
    const { sql, replacements } = buildReportSqlAndReplacements(templateSql, inputs, params);
    const safeSql = normalizeReadOnlySelectSql(sql);
    const rows = await sequelize.query(safeSql, { type: QueryTypes.SELECT, replacements });
    res.json({
      success: true,
      data: {
        report: {
          report_id: row.report_id,
          name: row.name,
          slug: row.slug,
          report_type: row.report_type,
          title_input_key: row.title_input_key,
          inputs,
          image_columns: imageColumns,
        },
        rows,
        rowCount: Array.isArray(rows) ? rows.length : 0,
      },
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Mount CRUD for all tables from schema (excludes backup_categories, backup_products, audit_logs)
Object.entries(schema).forEach(([table, { pk, cols }]) => {
  if (table === 'audit_logs') return; // read-only below
  const path = '/' + table.replace(/_/g, '-');
  if (table === 'products') {
    mountProducts(path, table, cols, pk);
  } else {
    mount(path, table, cols, pk);
  }
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
