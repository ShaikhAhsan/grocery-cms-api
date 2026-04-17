const express = require('express');
const { sequelize } = require('../../config/database');
const { QueryTypes } = require('sequelize');
const schema = require('../../db_schema.json');
const { publicApiErrorMessage } = require('../../utils/publicApiErrorMessage');

const router = express.Router();

function isDuplicateKeyError(err) {
  const orig = err?.original || err?.parent;
  const code = orig?.code || err?.code;
  const errno = orig?.errno ?? err?.errno;
  if (code === 'ER_DUP_ENTRY' || errno === 1062) return true;
  const msg = String(orig?.sqlMessage || err?.message || '');
  return /duplicate entry/i.test(msg);
}

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
    return res.status(400).json({ success: false, error: publicApiErrorMessage(err, 'Validation failed') });
  }
  if (err.duplicateField) {
    return res.status(409).json({
      success: false,
      error: publicApiErrorMessage(err, 'This value already exists.'),
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
  return res.status(500).json({ success: false, error: publicApiErrorMessage(err) });
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

/** Small reference tables: CMS loads full lists without `limit`; default 500 was too low for brand. */
function listLimitBounds(table) {
  if (table === 'brand' || table === 'categories' || table === 'tags') {
    return { defaultLimit: 50000, maxLimit: 200000 };
  }
  return { defaultLimit: 500, maxLimit: 20000 };
}

const api = (table, cols, idCol = 'id') => ({
  list: async (req, res) => {
    try {
      const { defaultLimit, maxLimit } = listLimitBounds(table);
      const offsetRaw = parseInt(req.query.offset, 10);
      const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;
      const limitRaw = req.query.limit != null ? parseInt(req.query.limit, 10) : defaultLimit;
      const limit =
        Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, maxLimit) : defaultLimit;
      const where = req.query.where ? ` WHERE ${req.query.where}` : '';
      const order = req.query.orderBy ? ` ORDER BY ${req.query.orderBy}` : ` ORDER BY \`${idCol}\``;
      const rows = await sequelize.query(
        `SELECT * FROM \`${table}\`${where}${order} LIMIT :limit OFFSET :offset`,
        { type: QueryTypes.SELECT, replacements: { limit, offset } }
      );
      const [countRow] = await sequelize.query(
        `SELECT COUNT(*) as c FROM \`${table}\`${where}`,
        { type: QueryTypes.SELECT }
      );
      return res.json({ success: true, data: rows, total: countRow?.c ?? 0 });
    } catch (err) {
      return res.status(500).json({ success: false, error: publicApiErrorMessage(err) });
    }
  },
  get: async (req, res) => {
    try {
      const [row] = await sequelize.query(
        `SELECT * FROM \`${table}\` WHERE \`${idCol}\` = :pkId`,
        { type: QueryTypes.SELECT, replacements: { pkId: req.params.id } }
      );
      if (!row) return res.status(404).json({ success: false, error: 'Not found' });
      return res.json({ success: true, data: row });
    } catch (err) {
      return res.status(500).json({ success: false, error: publicApiErrorMessage(err) });
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
      const lastRows = await sequelize.query('SELECT LAST_INSERT_ID() as id', { type: QueryTypes.SELECT });
      const insertId = (Array.isArray(lastRows) ? lastRows[0] : lastRows)?.id;
      if (insertId == null || insertId === 0) {
        return res.status(500).json({ success: false, error: 'Failed to get insert ID' });
      }
      const [row] = await sequelize.query(
        `SELECT * FROM \`${table}\` WHERE \`${idCol}\` = :pkId`,
        { type: QueryTypes.SELECT, replacements: { pkId: insertId } }
      );
      return res.status(201).json({ success: true, data: row });
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
      return res.json({ success: true, data: row });
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
        if (!existing) return res.status(404).json({ success: false, error: 'Not found' });
        const del = existing.is_deleted;
        const currentlyDeleted = del === 1 || del === true || String(del) === '1' || Number(del) === 1;
        const nextFlag = currentlyDeleted ? 0 : 1;
        const setParts = ['`is_deleted` = :nextFlag'];
        if (cols.includes('updated_at')) {
          setParts.push('`updated_at` = CURRENT_TIMESTAMP');
        }
        const [r] = await sequelize.query(
          `UPDATE \`${table}\` SET ${setParts.join(', ')} WHERE \`${idCol}\` = :pkId`,
          { replacements: { nextFlag, pkId: req.params.id } }
        );
        if (r.affectedRows === 0) return res.status(404).json({ success: false, error: 'Not found' });
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
      return res.json({ success: true, deleted: true });
    } catch (err) {
      return res.status(500).json({ success: false, error: publicApiErrorMessage(err) });
    }
  },
});

const PRODUCT_LIST_SORT_SQL = {
  product_name: 'p.product_name',
  image_updated_at: 'p.image_updated_at',
  created_at: 'p.created_at',
  updated_at: 'p.updated_at',
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
const PRODUCT_FILTER_MAX_RULES = 30;

function escapeSqlLikeFragment(str) {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

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
    for (let i = 0; i < orCols.length; i += 1) replacements.push(pat);
  }
  return { sql: andGroups.join(' AND '), replacements };
}

const PRODUCT_FILTER_FIELD_SQL = {
  product_name: 'p.product_name',
  sku: 'p.sku',
  slug: 'p.slug',
  unit: 'p.unit',
  image: 'p.image',
  thumb_image: 'p.thumb_image',
  brand_id: 'p.brand_id',
  stock_quantity: 'p.stock_quantity',
  minimum_qty: 'p.minimum_qty',
  price: 'p.price',
  old_price: 'p.old_price',
  is_active: 'p.is_active',
  is_verified: 'p.is_verified',
  is_deleted: 'p.is_deleted',
  created_at: 'p.created_at',
  updated_at: 'p.updated_at',
  image_updated_at: 'p.image_updated_at',
};
const PRODUCT_FILTER_TEXT_FIELDS = new Set(['product_name', 'sku', 'slug', 'unit', 'image', 'thumb_image']);
const PRODUCT_FILTER_NUMERIC_FIELDS = new Set([
  'brand_id',
  'stock_quantity',
  'minimum_qty',
  'price',
  'old_price',
  'is_active',
  'is_verified',
  'is_deleted',
]);

function parseProductFiltersRaw(rawFilters) {
  if (rawFilters == null || rawFilters === '') return null;
  if (typeof rawFilters === 'object') return rawFilters;
  const text = String(rawFilters || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function buildProductAdvancedFilterClause(rawFilters) {
  const parsed = parseProductFiltersRaw(rawFilters);
  if (!parsed || typeof parsed !== 'object') return { sql: '', replacements: [] };
  const logic = String(parsed.logic || 'AND').trim().toUpperCase() === 'OR' ? 'OR' : 'AND';
  const rules = Array.isArray(parsed.rules) ? parsed.rules.slice(0, PRODUCT_FILTER_MAX_RULES) : [];
  if (!rules.length) return { sql: '', replacements: [] };

  const compiledRules = [];
  const replacements = [];
  for (const rule of rules) {
    const field = String(rule?.field || '').trim();
    const op = String(rule?.op || '').trim().toLowerCase();
    const column = PRODUCT_FILTER_FIELD_SQL[field];
    if (!column || !op) continue;
    const value = rule?.value;
    const isTextField = PRODUCT_FILTER_TEXT_FIELDS.has(field);
    const isNumericField = PRODUCT_FILTER_NUMERIC_FIELDS.has(field);
    const join = String(rule?.join || logic).trim().toUpperCase() === 'OR' ? 'OR' : 'AND';

    if (op === 'is_empty') {
      compiledRules.push({
        sql: isTextField ? `(${column} IS NULL OR TRIM(${column}) = '')` : `(${column} IS NULL)`,
        join,
      });
      continue;
    }
    if (op === 'is_not_empty') {
      compiledRules.push({
        sql: isTextField ? `(${column} IS NOT NULL AND TRIM(${column}) <> '')` : `(${column} IS NOT NULL)`,
        join,
      });
      continue;
    }
    if (op === 'contains') {
      compiledRules.push({ sql: `${isTextField ? column : `CAST(${column} AS CHAR)`} LIKE ?`, join });
      replacements.push(`%${escapeSqlLikeFragment(String(value ?? ''))}%`);
      continue;
    }
    if (op === 'not_contains') {
      compiledRules.push({ sql: `${isTextField ? column : `CAST(${column} AS CHAR)`} NOT LIKE ?`, join });
      replacements.push(`%${escapeSqlLikeFragment(String(value ?? ''))}%`);
      continue;
    }
    if (op === 'starts_with') {
      compiledRules.push({ sql: `${isTextField ? column : `CAST(${column} AS CHAR)`} LIKE ?`, join });
      replacements.push(`${escapeSqlLikeFragment(String(value ?? ''))}%`);
      continue;
    }
    if (op === 'ends_with') {
      compiledRules.push({ sql: `${isTextField ? column : `CAST(${column} AS CHAR)`} LIKE ?`, join });
      replacements.push(`%${escapeSqlLikeFragment(String(value ?? ''))}`);
      continue;
    }
    if (op === 'eq' || op === 'neq') {
      const val = isNumericField ? Number(value) : value;
      if (isNumericField && !Number.isFinite(val)) continue;
      compiledRules.push({ sql: `${column} ${op === 'neq' ? '<>' : '='} ?`, join });
      replacements.push(val);
      continue;
    }
    if (['gt', 'gte', 'lt', 'lte'].includes(op)) {
      const num = Number(value);
      if (!Number.isFinite(num)) continue;
      const sqlOp = op === 'gt' ? '>' : op === 'gte' ? '>=' : op === 'lt' ? '<' : '<=';
      compiledRules.push({ sql: `${column} ${sqlOp} ?`, join });
      replacements.push(num);
      continue;
    }
    if (op === 'in' || op === 'not_in') {
      const arr = Array.isArray(value)
        ? value.map((v) => String(v ?? '').trim()).filter((v) => v !== '')
        : String(value ?? '')
            .split(',')
            .map((v) => v.trim())
            .filter((v) => v !== '');
      if (!arr.length) continue;
      const normalizedArr = isNumericField ? arr.map((v) => Number(v)).filter((n) => Number.isFinite(n)) : arr;
      if (!normalizedArr.length) continue;
      const placeholders = normalizedArr.map(() => '?').join(', ');
      compiledRules.push({
        sql: `${column} ${op === 'not_in' ? 'NOT IN' : 'IN'} (${placeholders})`,
        join,
      });
      replacements.push(...normalizedArr);
    }
  }
  if (!compiledRules.length) return { sql: '', replacements: [] };
  const sql = compiledRules.reduce((acc, item, idx) => {
    const block = `(${item.sql})`;
    if (idx === 0) return block;
    return `${acc} ${item.join} ${block}`;
  }, '');
  return { sql, replacements };
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
      ? { id: rest.brand_id, name: brandName ?? null, slug: brandSlug ?? null, image: brandImage ?? null }
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
    const { sql: advFilterSql, replacements: advFilterReps } = buildProductAdvancedFilterClause(req.query.filters);
    const legacyWhere = req.query.where ? String(req.query.where).trim() : '';
    const whereParts = [];
    const whereReplacements = [];
    if (legacyWhere) whereParts.push(`(${legacyWhere})`);
    if (searchSql) {
      whereParts.push(`(${searchSql})`);
      whereReplacements.push(...searchReps);
    }
    if (advFilterSql) {
      whereParts.push(`(${advFilterSql})`);
      whereReplacements.push(...advFilterReps);
    }
    const whereSql = whereParts.length ? ` WHERE ${whereParts.join(' AND ')}` : '';
    const order = productListOrderClause(req.query);
    const fromJoin = 'FROM products p LEFT JOIN brand b ON b.id = p.brand_id';
    const brandSelectSql = 'b.name AS _brand_name, b.slug AS _brand_slug, b.image AS _brand_image';

    const rowsSql = `SELECT p.*, ${brandSelectSql}
       ${fromJoin}
       ${whereSql}${order}
       LIMIT ? OFFSET ?`;
    const countSql = `SELECT COUNT(*) AS c ${fromJoin} ${whereSql}`;
    const [rows, countRows] = await Promise.all([
      sequelize.query(rowsSql, { type: QueryTypes.SELECT, replacements: [...whereReplacements, limit, offset] }),
      sequelize.query(countSql, { type: QueryTypes.SELECT, replacements: [...whereReplacements] }),
    ]);
    const countRow = countRows?.[0] || { c: 0 };
    const pids = rows.map((r) => r.product_id);
    const [catMap, tagMap] = await Promise.all([categoriesByProductIds(pids), tagsByProductIds(pids)]);
    const data = rows.map((row) => shapeProductRow(row, catMap, tagMap));
    return res.json({ success: true, data, total: countRow?.c ?? 0 });
  } catch (err) {
    return res.status(500).json({ success: false, error: publicApiErrorMessage(err) });
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
    const [catMap, tagMap] = await Promise.all([categoriesByProductIds([pid]), tagsByProductIds([pid])]);
    return res.json({ success: true, data: shapeProductRow(row, catMap, tagMap) });
  } catch (err) {
    return res.status(500).json({ success: false, error: publicApiErrorMessage(err) });
  }
}

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
    if (rows.length === 0) return res.status(404).json({ success: false, error: 'No product with this SKU' });
    if (rows.length > 1) {
      return res.status(409).json({
        success: false,
        error: 'Multiple products share this SKU; fix duplicates in the database first.',
      });
    }
    const row = rows[0];
    const pid = row.product_id;
    const [catMap, tagMap] = await Promise.all([categoriesByProductIds([pid]), tagsByProductIds([pid])]);
    return res.json({ success: true, data: shapeProductRow(row, catMap, tagMap) });
  } catch (err) {
    return res.status(500).json({ success: false, error: publicApiErrorMessage(err) });
  }
}

const mount = (path, table, cols, idCol = 'id') => {
  const a = api(table, cols, idCol);
  router.get(path, a.list);
  router.get(`${path}/:id`, a.get);
  router.post(path, a.create);
  router.put(`${path}/:id`, a.update);
  router.delete(`${path}/:id`, a.delete);
};

function mountProducts(path, table, cols, idCol) {
  const a = api(table, cols, idCol);
  router.get(path, productsListEnriched);
  router.get(`${path}/by-sku`, productsLookupBySku);
  router.get(`${path}/:id`, productsGetEnriched);
  router.post(path, a.create);
  router.put(`${path}/:id`, a.update);
  router.delete(`${path}/:id`, a.delete);
}

Object.entries(schema).forEach(([table, { pk, cols }]) => {
  if (table === 'audit_logs') return;
  const path = '/' + table.replace(/_/g, '-');
  if (table === 'products') {
    mountProducts(path, table, cols, pk);
  } else {
    mount(path, table, cols, pk);
  }
});

router.get('/audit-logs', async (req, res) => {
  try {
    const { limit = 100, offset = 0, table_name, record_id } = req.query;
    let where = '';
    const reps = { limit: parseInt(limit, 10), offset: parseInt(offset, 10) };
    if (table_name) {
      where += ' AND table_name = :table_name';
      reps.table_name = table_name;
    }
    if (record_id) {
      where += ' AND record_id = :record_id';
      reps.record_id = record_id;
    }
    const rows = await sequelize.query(
      `SELECT * FROM audit_logs WHERE 1=1${where} ORDER BY created_at DESC LIMIT :limit OFFSET :offset`,
      { type: QueryTypes.SELECT, replacements: reps }
    );
    const [countRow] = await sequelize.query(
      `SELECT COUNT(*) as c FROM audit_logs WHERE 1=1${where}`,
      { type: QueryTypes.SELECT, replacements: reps }
    );
    return res.json({ success: true, data: rows, total: countRow?.c ?? 0 });
  } catch (err) {
    return res.status(500).json({ success: false, error: publicApiErrorMessage(err) });
  }
});

module.exports = router;
