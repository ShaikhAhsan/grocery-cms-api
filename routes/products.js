/**
 * Products API - CRUD, search, sync, filters
 */
const express = require('express');
const axios = require('axios');
const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');
const { successResponse, errorResponse } = require('../utils/responseHandler');
const { processImageUrl } = require('../utils/helpers');

const router = express.Router();

function syncParentSkusUrl() {
  const fromEnv = (process.env.SYNC_PARENT_SKUS_URL || '').trim();
  if (fromEnv) return fromEnv;
  const port = parseInt(process.env.PORT || '8005', 10);
  return `http://127.0.0.1:${port}/products/sync-parent-skus`;
}

/** PHP empty() for sku: skip null, '', 0, '0', false, []. */
function isEmptySkuForSync(sku) {
  if (sku == null || sku === false) return true;
  if (Array.isArray(sku) && sku.length === 0) return true;
  if (sku === 0 || sku === '0') return true;
  if (typeof sku === 'string' && sku.trim() === '') return true;
  return false;
}

function formatDecimal2(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '0.00';
  return x.toFixed(2);
}

/** POST local `/products/sync-parent-skus` after bulk sync (replaces external Sheen URL). */
async function callLocalSyncParentSkus() {
  const url = syncParentSkusUrl();
  try {
    const res = await axios.post(url, {}, {
      headers: { 'Content-Type': 'application/json' },
      validateStatus: () => true,
      timeout: 120000,
    });
    const decoded = res.data && typeof res.data === 'object' ? res.data : {};
    return {
      statusCode: res.status,
      message: decoded.message ?? 'No message received',
      success: Boolean(decoded.success),
    };
  } catch (e) {
    return {
      statusCode: 0,
      message: e.message || 'No message received',
      success: false,
    };
  }
}

/** Parity with sync_products.php: upsert product_name, price, cost_price, stock_quantity, sku + local parent-SKU sync (no category_id). */
async function handleSyncProductsPhp(req, res) {
  try {
    const { products } = req.body || {};
    if (!Array.isArray(products)) {
      return res.status(200).json({
        success: false,
        message: 'Products array is required.',
      });
    }

    const stats = { total: 0, new: 0, updated: 0, unchanged: 0 };
    const upsertSql = `
      INSERT INTO products (product_name, price, cost_price, stock_quantity, sku)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        product_name = VALUES(product_name),
        price = CASE WHEN ? > 0 THEN ? ELSE price END,
        cost_price = CASE WHEN ? > 0 THEN ? ELSE cost_price END,
        stock_quantity = CASE WHEN ? >= 0 THEN ? ELSE stock_quantity END
    `;

    await sequelize.transaction(async (transaction) => {
      for (const product of products) {
        const sku = product?.sku;
        if (isEmptySkuForSync(sku)) continue;

        stats.total += 1;

        const productName = product.product_name ?? null;
        const priceStr = formatDecimal2(product.price ?? 0);
        const costStr = formatDecimal2(product.cost_price ?? 0);
        const stockRaw = product.stock_quantity ?? 0;
        const stockNum = Number(stockRaw);
        const stockVal = Number.isFinite(stockNum) ? stockNum : 0;

        const priceNum = parseFloat(priceStr);
        const costNum = parseFloat(costStr);

        // Sequelize MySQL: INSERT returns [insertId, affectedRows], not [OkPacket]
        const [, affectedRows] = await sequelize.query(upsertSql, {
          replacements: [
            productName,
            priceStr,
            costStr,
            stockVal,
            sku,
            priceNum,
            priceNum,
            costNum,
            costNum,
            stockVal,
            stockVal,
          ],
          transaction,
        });

        const ar = typeof affectedRows === 'number' ? affectedRows : 0;
        if (ar === 1) stats.new += 1;
        else if (ar === 2) stats.updated += 1;
        else if (ar === 0) stats.unchanged += 1;
      }
    });

    const parentSkusSync = await callLocalSyncParentSkus();

    const syncPayload = {
      statusCode: parentSkusSync.statusCode,
      message: parentSkusSync.message,
      success: parentSkusSync.success,
    };
    return res.status(200).json({
      success: true,
      total_products: stats.total,
      updated: stats.updated,
      new: stats.new,
      unchanged: stats.unchanged,
      parent_skus_sync: syncPayload,
      sheen_sync: syncPayload,
    });
  } catch (err) {
    return res.status(200).json({
      success: false,
      message: `Sync failed: ${err.message}`,
    });
  }
}

// sync_products.php — register before /:id and patch /:id so this path is never treated as an id
router.all('/sync_products', (req, res, next) => {
  if (req.method !== 'POST') {
    return res.status(200).json({ success: false, message: 'Only POST method allowed.' });
  }
  next();
});
router.post('/sync_products', handleSyncProductsPhp);

router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { product_name, price, is_active, is_deleted, is_verified } = req.body;

    const updateFields = {};
    if (product_name) updateFields.product_name = product_name;
    if (price != null) updateFields.price = price;
    if (is_active !== undefined) updateFields.is_active = is_active;
    if (is_deleted !== undefined) updateFields.is_deleted = is_deleted;
    if (is_verified !== undefined) updateFields.is_verified = is_verified;

    if (Object.keys(updateFields).length === 0) {
      return errorResponse(res, 'At least one field must be provided', 400);
    }
    updateFields.updated_at = new Date();

    const setClause = Object.keys(updateFields).map((k) => `\`${k}\` = ?`).join(', ');
    const values = [...Object.values(updateFields), id];
    await sequelize.query(
      `UPDATE products SET ${setClause} WHERE product_id = ?`,
      { replacements: values }
    );

    const products = await sequelize.query(
      'SELECT * FROM products WHERE product_id = ?',
      { type: QueryTypes.SELECT, replacements: [id] }
    );
    if (!products || products.length === 0) {
      return errorResponse(res, 'Product not found', 404);
    }

    const p = products[0];
    res.json({
      success: true,
      message: 'Product updated successfully',
      data: { ...p, image: processImageUrl(p.image), thumb_image: processImageUrl(p.thumb_image) },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /products/all - fetch all products (optional ?limit= & ?offset=)
router.get('/all', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 5000, 10000);
    const offset = parseInt(req.query.offset, 10) || 0;

    const products = await sequelize.query(
      `SELECT * FROM products ORDER BY product_id LIMIT ? OFFSET ?`,
      { type: QueryTypes.SELECT, replacements: [limit, offset] }
    );

    const [countRow] = await sequelize.query(
      'SELECT COUNT(*) as total FROM products',
      { type: QueryTypes.SELECT }
    );
    const total = countRow?.total ?? products.length;

    const processed = products.map((p) => ({
      ...p,
      image: processImageUrl(p.image),
      thumb_image: processImageUrl(p.thumb_image),
    }));

    successResponse(res, {
      products: processed,
      total,
      limit,
      offset,
    }, 'Products fetched successfully');
  } catch (err) {
    errorResponse(res, err.message);
  }
});

router.get('/sku/:sku', async (req, res) => {
  try {
    const products = await sequelize.query(
      'SELECT * FROM products WHERE sku = ?',
      { type: QueryTypes.SELECT, replacements: [req.params.sku] }
    );
    if (products.length === 0) {
      return errorResponse(res, 'Product not found with this SKU', 404);
    }
    const p = products[0];
    successResponse(res, {
      ...p,
      image: processImageUrl(p.image),
      thumb_image: processImageUrl(p.thumb_image),
    }, 'Product fetched successfully');
  } catch (err) {
    errorResponse(res, err.message);
  }
});

router.post('/', async (req, res) => {
  try {
    const { product_name, product_description, brand_id, price, cost_price, stock_quantity, sku, image } = req.body;
    await sequelize.query(
      `INSERT INTO products (product_name, product_description, brand_id, price, cost_price, stock_quantity, sku, image)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      {
        replacements: [product_name, product_description || null, brand_id || null, price, cost_price, stock_quantity || 0, sku || null, image || null],
      }
    );
    const insRows = await sequelize.query('SELECT LAST_INSERT_ID() as id', { type: QueryTypes.SELECT });
    successResponse(res, { product_id: insRows[0]?.id }, 'Product created successfully', 201);
  } catch (err) {
    errorResponse(res, err.message);
  }
});

router.put('/:id/deactivate', async (req, res) => {
  try {
    await sequelize.query('UPDATE products SET is_active = 0 WHERE product_id = ?', {
      replacements: [req.params.id],
    });
    successResponse(res, null, 'Product deactivated successfully');
  } catch (err) {
    errorResponse(res, err.message);
  }
});

router.get('/category/:category_id', async (req, res) => {
  try {
    const { category_id } = req.params;
    let { page, limit } = req.query;
    page = parseInt(page) || 1;
    limit = parseInt(limit) || 10;
    const offset = (page - 1) * limit;

    const countRows = await sequelize.query(
      `SELECT COUNT(*) AS total FROM products p
       JOIN product_categories pc ON pc.product_id = p.product_id AND pc.category_id = ?`,
      { type: QueryTypes.SELECT, replacements: [category_id] }
    );
    const total = countRows[0]?.total ?? 0;

    const products = await sequelize.query(
      `SELECT p.product_id, p.product_name, p.product_description, p.brand_id, p.price, p.cost_price,
              p.stock_quantity, p.sku, p.image, p.thumb_image, p.created_at, p.updated_at, p.is_active
       FROM products p
       JOIN product_categories pc ON pc.product_id = p.product_id AND pc.category_id = ?
       LIMIT ? OFFSET ?`,
      { type: QueryTypes.SELECT, replacements: [category_id, limit, offset] }
    );

    const processed = products.map((p) => ({
      ...p,
      image: processImageUrl(p.image),
      thumb_image: processImageUrl(p.thumb_image),
    }));

    successResponse(res, {
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      totalProducts: total,
      products: processed,
    }, 'Products fetched successfully');
  } catch (err) {
    errorResponse(res, err.message);
  }
});

router.get('/search', async (req, res) => {
  try {
    const { keyword } = req.query;
    let { page, limit } = req.query;
    if (!keyword) return errorResponse(res, 'Keyword is required for search', 400);
    page = parseInt(page) || 1;
    limit = parseInt(limit) || 10;
    const offset = (page - 1) * limit;

    const likePattern = `%${keyword}%`;
    const countRows = await sequelize.query(
      `SELECT COUNT(*) as total FROM products
       WHERE product_name LIKE ? OR product_description LIKE ?`,
      { type: QueryTypes.SELECT, replacements: [likePattern, likePattern] }
    );
    const total = countRows[0]?.total ?? 0;

    const products = await sequelize.query(
      `SELECT product_id, product_name, product_description, brand_id, price, cost_price,
              stock_quantity, sku, image, thumb_image, created_at, updated_at, is_active
       FROM products
       WHERE product_name LIKE ? OR product_description LIKE ?
       ORDER BY product_name
       LIMIT ? OFFSET ?`,
      { type: QueryTypes.SELECT, replacements: [likePattern, likePattern, limit, offset] }
    );

    if (products.length === 0) {
      return errorResponse(res, 'No products found matching the search criteria', 404);
    }

    const processed = products.map((p) => ({
      ...p,
      image: processImageUrl(p.image),
      thumb_image: processImageUrl(p.thumb_image),
    }));

    successResponse(res, {
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      totalResults: total,
      products: processed,
    }, 'Search results fetched successfully');
  } catch (err) {
    errorResponse(res, err.message);
  }
});

router.get('/:id', async (req, res, next) => {
  if (!req.params.id || req.params.id === '') return next(); // Let GET / handle root path
  try {
    const products = await sequelize.query(
      'SELECT * FROM products WHERE product_id = ?',
      { type: QueryTypes.SELECT, replacements: [req.params.id] }
    );
    if (products.length === 0) return errorResponse(res, 'Product not found', 404);
    const p = products[0];
    successResponse(res, {
      ...p,
      image: processImageUrl(p.image),
      thumb_image: processImageUrl(p.thumb_image),
    }, 'Product fetched successfully');
  } catch (err) {
    errorResponse(res, err.message);
  }
});

router.post('/upsert', async (req, res) => {
  try {
    const body = req.body;
    const {
      product_id, product_name, price, cost_price, stock_quantity, sku,
      parent_sku, parent_quantity, parent_sku_pack_discount, is_active, is_verified, is_deleted,
    } = body;

    const cols = ['product_name', 'price', 'cost_price', 'stock_quantity', 'sku'];
    const vals = [product_name, price, cost_price, stock_quantity || 0, sku];
    if (parent_sku !== undefined) { cols.push('parent_sku'); vals.push(parent_sku); }
    if (parent_quantity !== undefined) { cols.push('parent_quantity'); vals.push(parent_quantity); }
    if (parent_sku_pack_discount !== undefined) { cols.push('parent_sku_pack_discount'); vals.push(parent_sku_pack_discount); }
    if (is_active !== undefined) { cols.push('is_active'); vals.push(is_active); }
    if (is_verified !== undefined) { cols.push('is_verified'); vals.push(is_verified); }
    if (is_deleted !== undefined) { cols.push('is_deleted'); vals.push(is_deleted); }

    const colList = cols.join(', ');
    const placeholders = vals.map(() => '?').join(', ');
    const updateList = cols.filter((c) => c !== 'product_id').map((c) => `\`${c}\` = VALUES(\`${c}\`)`).join(', ');

    let query = `INSERT INTO products (${product_id != null ? 'product_id, ' : ''}${colList}) VALUES (${product_id != null ? '?, ' : ''}${placeholders})`;
    if (product_id != null) vals.unshift(product_id);
    query += ` ON DUPLICATE KEY UPDATE ${updateList}`;

    const [lastInsertId, affectedRows] = await sequelize.query(query, { replacements: vals });
    const ar = typeof affectedRows === 'number' ? affectedRows : 0;
    const insertId =
      typeof lastInsertId === 'number' && lastInsertId > 0 ? lastInsertId : product_id;

    successResponse(res, {
      product_id: insertId,
      affected_rows: ar,
    }, ar === 1 ? 'Product created successfully' : ar === 2 ? 'Product updated successfully' : 'Product saved');
  } catch (err) {
    errorResponse(res, err.message);
  }
});

router.post('/sync', async (req, res) => {
  try {
    const { products } = req.body;
    if (!Array.isArray(products) || products.length === 0) {
      return errorResponse(res, 'Products array is required and should not be empty.');
    }

    for (const p of products) {
      const { product_name, price, cost_price, stock_quantity, sku } = p;
      const existingRows = await sequelize.query(
        'SELECT product_id FROM products WHERE sku = ?',
        { type: QueryTypes.SELECT, replacements: [sku] }
      );

      if (existingRows.length > 0) {
        await sequelize.query(
          'UPDATE products SET price = ?, cost_price = ?, stock_quantity = ? WHERE sku = ?',
          { replacements: [price, cost_price, stock_quantity, sku] }
        );
      } else {
        await sequelize.query(
          'INSERT INTO products (product_name, price, cost_price, stock_quantity, sku) VALUES (?, ?, ?, ?, ?)',
          { replacements: [product_name, price, cost_price, stock_quantity, sku] }
        );
      }
    }
    successResponse(res, null, 'Products synced successfully');
  } catch (err) {
    errorResponse(res, err.message);
  }
});

router.post('/sync-parent-skus', async (req, res) => {
  try {
    const productsWithParent = await sequelize.query(
      `SELECT product_id, parent_sku, parent_quantity, parent_sku_pack_discount
       FROM products WHERE parent_sku IS NOT NULL AND parent_sku != ''`,
      { type: QueryTypes.SELECT }
    );

    for (const parent of productsWithParent) {
      const { product_id, parent_sku, parent_quantity, parent_sku_pack_discount } = parent;
      if (!parent_sku || !parent_quantity) continue;

      const childRows = await sequelize.query(
        'SELECT price, cost_price, stock_quantity FROM products WHERE sku = ? LIMIT 1',
        { type: QueryTypes.SELECT, replacements: [parent_sku] }
      );
      if (childRows.length === 0) continue;

      const c = childRows[0];
      const newStock = Math.floor((c.stock_quantity || 0) / parent_quantity);
      const newPrice = (c.price || 0) * parent_quantity - (parent_sku_pack_discount || 0);
      const newCostPrice = (c.cost_price || 0) * parent_quantity;

      await sequelize.query(
        'UPDATE products SET price = ?, cost_price = ?, stock_quantity = ? WHERE product_id = ?',
        { replacements: [newPrice, newCostPrice, newStock, product_id] }
      );
    }
    successResponse(res, null, 'Parent products updated successfully');
  } catch (err) {
    errorResponse(res, err.message || 'An error occurred while syncing products.');
  }
});

// GET / - filtered, sorted, paginated products (use allproducts=true to return all)
router.get('/', async (req, res) => {
  try {
    const q = req.query;
    const ap = String(q.allproducts || '').toLowerCase().trim();
    const allProducts = ap === 'true' || ap === '1' || ap === 'yes';
    const pageNum = allProducts ? 1 : Math.max(1, parseInt(q.page) || 1);
    const limitNum = allProducts ? 50000 : Math.max(1, Math.min(parseInt(q.limit) || 10, 100));
    const validSortFields = [
      'product_name', 'price', 'sku', 'created_at', 'updated_at', 'stock_quantity',
      'is_active', 'is_verified', 'parent_sku', 'parent_quantity', 'parent_sku_pack_discount', 'is_deleted',
    ];
    const sortBy = validSortFields.includes(q.sort_by) ? q.sort_by : 'product_name';
    const sortOrder = ['ASC', 'DESC'].includes((q.sort_order || '').toUpperCase()) ? q.sort_order.toUpperCase() : 'ASC';

    let baseQuery = 'SELECT p.* FROM products p WHERE 1=1';
    const params = [];

    if (q.exclude_category) {
      baseQuery += ` AND p.product_id NOT IN (SELECT product_id FROM product_categories WHERE category_id = ?)`;
      params.push(q.exclude_category);
    }
    if (q.category) {
      baseQuery += ` AND p.product_id IN (SELECT product_id FROM product_categories WHERE category_id = ?)`;
      params.push(q.category);
    }
    if (q.sku) {
      const normalizedSku = (q.sku || '').replace(/^0+/, '');
      baseQuery += ' AND (p.sku LIKE ? OR p.sku = ?)';
      params.push(normalizedSku.includes('%') ? normalizedSku : normalizedSku, q.sku);
    }
    if (q.parent_sku) { baseQuery += ' AND p.parent_sku = ?'; params.push(q.parent_sku); }
    if (q.name) { baseQuery += ' AND p.product_name LIKE ?'; params.push(`%${q.name}%`); }
    if (q.min_price) { baseQuery += ' AND p.price >= ?'; params.push(q.min_price); }
    if (q.max_price) { baseQuery += ' AND p.price <= ?'; params.push(q.max_price); }
    if (q.active_only === 'true' || q.active_only === true) baseQuery += ' AND p.is_active = 1';
    if (q.is_active !== undefined) { baseQuery += ' AND p.is_active = ?'; params.push(q.is_active); }
    if (q.verified_only === 'true' || q.verified_only === true) baseQuery += ' AND p.is_verified = 1';
    if (q.is_verified !== undefined) { baseQuery += ' AND p.is_verified = ?'; params.push(q.is_verified); }
    if (q.is_deleted !== undefined) { baseQuery += ' AND p.is_deleted = ?'; params.push(q.is_deleted); }
    if (q.missing_image === 'true' || q.missing_image === true) baseQuery += " AND (p.image IS NULL OR p.image = '')";
    if (q.missing_image === 'false' || q.missing_image === false) baseQuery += " AND (p.image IS NOT NULL AND p.image != '')";
    if (q.has_parent_sku === 'true' || q.has_parent_sku === true) baseQuery += " AND (p.parent_sku IS NOT NULL AND p.parent_sku != '')";
    if (q.stock_quantity !== undefined) { baseQuery += ' AND p.stock_quantity = ?'; params.push(q.stock_quantity); }
    if (q.min_quantity !== undefined) { baseQuery += ' AND p.stock_quantity >= ?'; params.push(q.min_quantity); }
    if (q.parent_sku_pack_discount_gt !== undefined) { baseQuery += ' AND p.parent_sku_pack_discount > ?'; params.push(q.parent_sku_pack_discount_gt); }

    const countRows = await sequelize.query(
      `SELECT COUNT(*) as total FROM (${baseQuery}) as filtered`,
      { type: QueryTypes.SELECT, replacements: params }
    );
    const totalItems = countRows[0]?.total || 0;
    const totalPages = allProducts ? 1 : Math.ceil(totalItems / limitNum);

    baseQuery += ` ORDER BY p.${sortBy} ${sortOrder}`;
    if (!allProducts) {
      baseQuery += ' LIMIT ? OFFSET ?';
      params.push(limitNum, (pageNum - 1) * limitNum);
    }

    const allProductsResult = await sequelize.query(baseQuery, {
      type: QueryTypes.SELECT,
      replacements: params,
    });

    const products = allProductsResult.map((p) => ({
      ...p,
      image: processImageUrl(p.image),
      thumb_image: processImageUrl(p.thumb_image),
    }));

    successResponse(res, {
      products,
      pagination: {
        total_items: totalItems,
        total_pages: totalPages,
        current_page: pageNum,
        items_per_page: allProducts ? products.length : limitNum,
        has_next_page: allProducts ? false : pageNum < totalPages,
        has_prev_page: pageNum > 1,
        version: 1.0,
      },
    }, 'Products fetched successfully');
  } catch (err) {
    errorResponse(res, err.message);
  }
});

module.exports = router;
module.exports.handleSyncProductsPhp = handleSyncProductsPhp;
