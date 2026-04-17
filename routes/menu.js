/**
 * Public menu/catalog API - products, categories from grocery_store_db
 */
const express = require('express');
const router = express.Router();
const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');
const { publicApiErrorMessage } = require('../utils/publicApiErrorMessage');

// GET /api/v1/menu/categories - categories with product counts
router.get('/categories', async (req, res) => {
  try {
    const categories = await sequelize.query(
      `SELECT c.category_id, c.category_name, c.slug, c.category_description, c.image, c.position, c.is_active,
              (SELECT COUNT(*) FROM product_categories pc WHERE pc.category_id = c.category_id) as product_count
       FROM categories c
       WHERE c.is_active = 1
       ORDER BY c.position, c.category_name`,
      { type: QueryTypes.SELECT }
    );
    res.json({ success: true, data: categories });
  } catch (err) {
    res.status(500).json({ success: false, error: publicApiErrorMessage(err) });
  }
});

// GET /api/v1/menu/products - products (optional ?categoryId=)
router.get('/products', async (req, res) => {
  try {
    const { categoryId } = req.query;
    let sql = `
      SELECT p.product_id, p.product_name, p.slug, p.product_description, p.price, p.old_price,
             p.thumb_image, p.image, p.stock_quantity, p.sku, p.brand_id, p.is_active
      FROM products p
      WHERE p.is_active = 1 AND (p.is_deleted = 0 OR p.is_deleted IS NULL)
    `;
    const replacements = {};
    if (categoryId) {
      sql = `
        SELECT p.product_id, p.product_name, p.slug, p.product_description, p.price, p.old_price,
               p.thumb_image, p.image, p.stock_quantity, p.sku, p.brand_id, p.is_active
        FROM products p
        JOIN product_categories pc ON pc.product_id = p.product_id AND pc.category_id = :categoryId
        WHERE p.is_active = 1 AND (p.is_deleted = 0 OR p.is_deleted IS NULL)
      `;
      replacements.categoryId = categoryId;
    }
    sql += ' ORDER BY p.product_name';

    const products = await sequelize.query(sql, {
      type: QueryTypes.SELECT,
      replacements: Object.keys(replacements).length ? replacements : undefined,
    });
    res.json({ success: true, data: products });
  } catch (err) {
    res.status(500).json({ success: false, error: publicApiErrorMessage(err) });
  }
});

// GET /api/v1/menu/brands - brands
router.get('/brands', async (req, res) => {
  try {
    const brands = await sequelize.query(
      `SELECT id, name, slug, image, is_active FROM brand WHERE is_active = 1 ORDER BY name`,
      { type: QueryTypes.SELECT }
    );
    res.json({ success: true, data: brands });
  } catch (err) {
    res.status(500).json({ success: false, error: publicApiErrorMessage(err) });
  }
});

// GET /api/v1/menu/full - full catalog (categories with products)
router.get('/full', async (req, res) => {
  try {
    const categories = await sequelize.query(
      `SELECT category_id, category_name, slug, category_description, image, position
       FROM categories WHERE is_active = 1 ORDER BY position, category_name`,
      { type: QueryTypes.SELECT }
    );

    const products = await sequelize.query(
      `SELECT p.product_id, p.product_name, p.slug, p.product_description, p.price, p.old_price,
              p.thumb_image, p.image, p.stock_quantity, p.brand_id
       FROM products p
       WHERE p.is_active = 1 AND (p.is_deleted = 0 OR p.is_deleted IS NULL)
       ORDER BY p.product_name`,
      { type: QueryTypes.SELECT }
    );

    const productCats = await sequelize.query(
      `SELECT product_id, category_id FROM product_categories`,
      { type: QueryTypes.SELECT }
    );

    const byCat = {};
    productCats.forEach((pc) => {
      if (!byCat[pc.category_id]) byCat[pc.category_id] = [];
      const prod = products.find((p) => p.product_id === pc.product_id);
      if (prod) byCat[pc.category_id].push(prod);
    });

    const result = categories.map((cat) => ({
      ...cat,
      products: byCat[cat.category_id] || [],
    }));

    const brands = await sequelize.query(
      `SELECT id, name, slug, image FROM brand WHERE is_active = 1 ORDER BY name`,
      { type: QueryTypes.SELECT }
    ).catch(() => []);

    res.json({
      success: true,
      data: result,
      brands: brands || [],
    });
  } catch (err) {
    res.status(500).json({ success: false, error: publicApiErrorMessage(err) });
  }
});

module.exports = router;
