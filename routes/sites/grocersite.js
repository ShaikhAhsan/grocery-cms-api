/**
 * Grocer site - backup products, fetch missing images from backup
 */
const express = require('express');
const axios = require('axios');
const { sequelize } = require('../../config/database');
const { QueryTypes } = require('sequelize');
const { successResponse, errorResponse } = require('../../utils/responseHandler');

const router = express.Router();

async function fetchAllCategoryIds(vendorId = 20) {
  const url = `https://endpoints.grocerapps.com/v2/categories/list?vendor_id=${vendorId}`;
  try {
    const response = await axios.get(url);
    const tree = response.data?.data?.tree || [];
    const ids = [];
    function extract(cats, level = 1) {
      if (level > 4 || !Array.isArray(cats)) return;
      for (const c of cats) {
        ids.push(c.id);
        if (c.subcat?.length) extract(c.subcat, level + 1);
      }
    }
    extract(tree);
    return ids;
  } catch (e) {
    return [];
  }
}

async function hasTable(name) {
  try {
    await sequelize.query(`SELECT 1 FROM \`${name}\` LIMIT 1`);
    return true;
  } catch {
    return false;
  }
}

router.get('/backup-products', async (req, res) => {
  try {
    const hasBackupProducts = await hasTable('backup_products');
    if (!hasBackupProducts) {
      return errorResponse(res, 'backup_products table does not exist', 400);
    }
    const vendorId = parseInt(req.query.vendor_id, 10) || 20;
    const categoryIds = await fetchAllCategoryIds(vendorId);
    for (const categoryId of categoryIds) {
      try {
        const url = `https://endpoints.grocerapps.com/v3/products/listByParent?per=5000&page=1&vendor_id=${vendorId}&category_id=${categoryId}`;
        const response = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
        const products = response.data?.data?.data || [];
        for (const p of products) {
          await sequelize.query(
            `INSERT INTO backup_products (id, category_id, weight, price, vendor_product_id, name, seo_url, name_ur, unit, description, barcode, sold_times, image, vendor_id, is_featured, is_deal, deal_title, deal_percentage, deal_expiry, vendor_status, deleted_at, max_purchase_limit, full_image, flash_deal)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE category_id=VALUES(category_id), price=VALUES(price), name=VALUES(name)`,
            {
              replacements: [
                p.id, p.category_id, p.weight, p.price, p.vendor_product_id, p.name, p.seo_url, p.name_ur,
                p.unit, p.desc, p.barcode, p.sold_times, p.image, p.vendor_id, p.is_featured, p.is_deal,
                p.deal_title, p.deal_percentage, p.deal_expiry, p.vendor_status, p.deleted_at,
                p.max_purchase_limit, p.full_image, p.flash_deal,
              ],
            }
          );
        }
      } catch (e) {
        console.warn(`Backup category ${categoryId} failed:`, e.message);
      }
    }
    successResponse(res, null, 'Products backed up successfully.');
  } catch (err) {
    errorResponse(res, err);
  }
});

router.get('/fetch-missing-images', async (req, res) => {
  try {
    const hasBackup = await hasTable('backup_products');
    if (!hasBackup) {
      return successResponse(res, [], 'backup_products table not present - no images to fetch');
    }
    const limit = parseInt(req.query.limit, 10) || 20;
    const products = await sequelize.query(
      `SELECT p.sku, bp.full_image as image, CONCAT(bp.name, ' (', bp.unit, ')') AS name
       FROM products p
       JOIN backup_products bp ON p.sku = bp.barcode
       WHERE p.image IS NULL AND p.is_active = 1
       LIMIT ?`,
      { type: QueryTypes.SELECT, replacements: [limit] }
    );

    if (products.length === 0) {
      return successResponse(res, [], 'No images to download');
    }

    const results = products.map((p) => ({
      sku: p.sku,
      name: p.name,
      image: p.image,
      status: p.image ? 'url_available' : 'no_image',
    }));
    successResponse(res, results, 'Image fetch process completed');
  } catch (err) {
    errorResponse(res, err);
  }
});

module.exports = router;
