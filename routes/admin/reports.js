const express = require('express');
const { sequelize } = require('../../config/database');
const { QueryTypes } = require('sequelize');

const router = express.Router();

function isDuplicateKeyError(err) {
  const orig = err?.original || err?.parent;
  const code = orig?.code || err?.code;
  const errno = orig?.errno ?? err?.errno;
  if (code === 'ER_DUP_ENTRY' || errno === 1062) return true;
  const msg = String(orig?.sqlMessage || err?.message || '');
  return /duplicate entry/i.test(msg);
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

function parseReportRow(r) {
  return {
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
  };
}

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
    return res.json({ success: true, data: rows.map(parseReportRow) });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
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
    return res.json({ success: true, data: rows.map(parseReportRow) });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
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
    return res.json({ success: true, data: parseReportRow(row) });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
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
    return res.json({ success: true, data: parseReportRow(row) });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
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
    return res.status(201).json({ success: true, data: parseReportRow(row) });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      return res.status(409).json({ success: false, error: 'Report slug already exists' });
    }
    return res.status(400).json({ success: false, error: err.message });
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
    return res.json({ success: true, data: parseReportRow(row) });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      return res.status(409).json({ success: false, error: 'Report slug already exists' });
    }
    return res.status(400).json({ success: false, error: err.message });
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
    return res.json({ success: true, deleted: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
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
    return res.json({
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
    return res.status(400).json({ success: false, error: err.message });
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
    return res.json({
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
    return res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
