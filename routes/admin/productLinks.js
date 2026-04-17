const express = require('express');
const { sequelize } = require('../../config/database');
const { QueryTypes } = require('sequelize');

const router = express.Router();

/**
 * Active products for a brand (non-deleted).
 * GET /api/v1/admin/brand-product-count/:id
 */
router.get('/brand-product-count/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Invalid brand id' });
    }
    const [row] = await sequelize.query(
      `SELECT COUNT(*) as c FROM products WHERE brand_id = :id AND (is_deleted = 0 OR is_deleted IS NULL)`,
      { type: QueryTypes.SELECT, replacements: { id } }
    );
    return res.json({ success: true, data: { count: Number(row?.c ?? 0) } });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

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
    return res.json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
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
    return res.json({ success: true });
  } catch (err) {
    if (t) await t.rollback();
    return res.status(500).json({ success: false, error: err.message });
  }
});

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
      return res.json({
        success: true,
        data: { appended: false, category_ids: rows.map((r) => r.category_id) },
      });
    }
    const [maxRow] = await sequelize.query(
      `SELECT COALESCE(MAX(position), 0) as m FROM product_categories WHERE product_id = :productId`,
      { type: QueryTypes.SELECT, replacements: { productId } }
    );
    const pos = (Number(maxRow?.m || 0) || 0) + 1;
    await sequelize.query(
      `INSERT INTO product_categories (category_id, product_id, position) VALUES (:cid, :pid, :pos)`,
      { replacements: { cid: categoryId, pid: productId, pos } }
    );
    const rows = await sequelize.query(
      `SELECT category_id FROM product_categories WHERE product_id = :productId ORDER BY position ASC`,
      { type: QueryTypes.SELECT, replacements: { productId } }
    );
    return res.json({
      success: true,
      data: { appended: true, category_ids: rows.map((r) => r.category_id) },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

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
    return res.json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
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
    return res.json({ success: true });
  } catch (err) {
    if (t) await t.rollback();
    return res.status(500).json({ success: false, error: err.message });
  }
});

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
      return res.json({ success: true, data: { appended: false, tag_ids: rows.map((r) => r.tag_id) } });
    }
    await sequelize.query(
      `INSERT INTO product_tags (product_id, tag_id, created_at) VALUES (:pid, :tid, NOW())`,
      { replacements: { pid: productId, tid: tagId } }
    );
    const rows = await sequelize.query(
      `SELECT tag_id FROM product_tags WHERE product_id = :productId ORDER BY tag_id ASC`,
      { type: QueryTypes.SELECT, replacements: { productId } }
    );
    return res.json({ success: true, data: { appended: true, tag_ids: rows.map((r) => r.tag_id) } });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
