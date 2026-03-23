/**
 * Backup routes - backup products/brands from external sources
 * Note: backup_products and backup_categories tables may not exist in grocery schema
 */
const express = require('express');
const axios = require('axios');
const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');
const { successResponse, errorResponse } = require('../utils/responseHandler');

const router = express.Router();

const hasTable = async (name) => {
  try {
    await sequelize.query(`SELECT 1 FROM \`${name}\` LIMIT 1`);
    return true;
  } catch {
    return false;
  }
};

router.get('/backup-products', async (req, res) => {
  try {
    const hasBackup = await hasTable('backup_categories');
    if (!hasBackup) {
      return errorResponse(res, 'backup_categories table does not exist in this database', 400);
    }
    const ids = await sequelize.query('SELECT id FROM backup_categories', { type: QueryTypes.SELECT });
    const categoryIds = (ids || []).map((r) => r.id);
    let processed = 0;
    for (const categoryId of categoryIds.slice(0, 6)) {
      try {
        const url = `https://endpoints.grocerapps.com/v3/products/listByParent?per=1&page=1&vendor_id=20&category_id=${categoryId}`;
        const response = await axios.get(url, {
          headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
        });
        if (response.data?.status === 'success' && response.data?.data?.data) {
          const products = response.data.data.data;
          const hasBackupProducts = await hasTable('backup_products');
          if (hasBackupProducts && products.length > 0) {
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
          }
          processed++;
        }
      } catch (e) {
        console.warn(`Backup category ${categoryId} failed:`, e.message);
      }
    }
    successResponse(res, null, 'Products backed up successfully.');
  } catch (err) {
    errorResponse(res, err.message);
  }
});

router.get('/backup-brands', async (req, res) => {
  try {
    const url = 'https://endpoints.grocerapps.com/v2/brands/all?vendor_id=20&limit=5000';
    const response = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
    });
    const brands = response.data?.data || [];
    for (const brand of brands) {
      const [existing] = await sequelize.query('SELECT id FROM brand WHERE name = ? LIMIT 1', {
        type: QueryTypes.SELECT,
        replacements: [brand.name],
      });
      if (existing.length > 0) continue;

      await sequelize.query(
        `INSERT INTO brand (name, slug, \`rank\`, grouping_type_id, is_active, image, brand_slider_image, created_at, updated_at, products)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        {
          replacements: [
            brand.name, brand.slug || '', brand.rank || 0, brand.grouping_type_id || null,
            brand.is_active !== undefined ? brand.is_active : 1,
            brand.image || null, brand.brand_slider_image || null,
            brand.created_at || new Date(), brand.updated_at || new Date(), brand.products || null,
          ],
        }
      );
    }
    successResponse(res, null, 'Brands backed up successfully.');
  } catch (err) {
    errorResponse(res, err.message);
  }
});

module.exports = router;
