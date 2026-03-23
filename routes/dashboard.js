/**
 * Dashboard API - product statistics
 */
const express = require('express');
const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');
const { successResponse, errorResponse } = require('../utils/responseHandler');

const router = express.Router();

const queries = {
  active_products: 'SELECT COUNT(*) as total FROM products WHERE is_active = 1 AND (is_deleted = 0 OR is_deleted IS NULL)',
  deleted_products: 'SELECT COUNT(*) as total FROM products WHERE is_deleted = 1',
  missing_images: 'SELECT COUNT(*) as total FROM products WHERE is_active = 1 AND (image IS NULL OR image = \'\') AND (is_deleted = 0 OR is_deleted IS NULL)',
  verified_products: 'SELECT COUNT(*) as total FROM products WHERE is_verified = 1 AND (is_deleted = 0 OR is_deleted IS NULL)',
  parent_sku_products: 'SELECT COUNT(*) as total FROM products WHERE parent_sku IS NOT NULL AND parent_sku != \'\' AND (is_deleted = 0 OR is_deleted IS NULL)',
  active_zero_quantity_products: 'SELECT COUNT(*) as total FROM products WHERE is_active = 1 AND stock_quantity = 0 AND (is_deleted = 0 OR is_deleted IS NULL)',
  active_quantity_products: 'SELECT COUNT(*) as total FROM products WHERE is_active = 1 AND stock_quantity >= 1 AND is_verified = 0 AND (is_deleted = 0 OR is_deleted IS NULL)',
  active_quantity_products_missing_images: 'SELECT COUNT(*) as total FROM products WHERE is_active = 1 AND stock_quantity >= 1 AND (is_deleted = 0 OR is_deleted IS NULL) AND is_verified = 0 AND (image IS NULL OR image = \'\')',
  inactive_products: 'SELECT COUNT(*) as total FROM products WHERE is_active = 0 AND (is_deleted = 0 OR is_deleted IS NULL)',
  products_no_thumb_image: 'SELECT COUNT(*) as total FROM products WHERE is_active = 1 AND (thumb_image IS NULL OR thumb_image = \'\') AND (is_deleted = 0 OR is_deleted IS NULL)',
  products_with_discount_pack: 'SELECT COUNT(*) as total FROM products WHERE parent_sku_pack_discount > 0 AND (is_deleted = 0 OR is_deleted IS NULL)',
  need_to_be_verified: 'SELECT COUNT(*) as total FROM products WHERE (is_deleted = 0 OR is_deleted IS NULL) AND is_verified = 0 AND (image IS NOT NULL AND image != \'\') AND stock_quantity > 0 AND is_active = 1',
};

router.get('/', async (req, res) => {
  try {
    const stats = {};
    for (const [key, sql] of Object.entries(queries)) {
      const [row] = await sequelize.query(sql, { type: QueryTypes.SELECT });
      stats[key] = row?.total ?? 0;
    }

    const dashboard = [
      { name: 'Active Products', type: 'count', count: stats.active_products, filters: { active_only: true } },
      { name: 'Deleted Products', type: 'count', count: stats.deleted_products, filters: { is_deleted: 1 } },
      { name: 'Active Products Missing Images', type: 'count', count: stats.missing_images, filters: { active_only: true, missing_image: true } },
      { name: 'Un-Verified Products', type: 'count', count: stats.need_to_be_verified, filters: { active_only: true, is_verified: 0, missing_image: false, min_quantity: 1 } },
      { name: 'Verified Products', type: 'count', count: stats.verified_products, filters: { active_only: true, is_verified: 1 } },
      { name: 'Products with Parent SKU', type: 'count', count: stats.parent_sku_products, filters: { has_parent_sku: true } },
      { name: 'Active Products with 0 Quantity', type: 'count', count: stats.active_zero_quantity_products, filters: { active_only: true, stock_quantity: 0 } },
      { name: 'Active Products with Quantity', type: 'count', count: stats.active_quantity_products, filters: { active_only: true, min_quantity: 1, is_verified: false } },
      { name: 'Active Products with Quantity But Missing Images', type: 'count', count: stats.active_quantity_products_missing_images, filters: { active_only: true, min_quantity: 1, missing_image: true, is_verified: false } },
      { name: 'Inactive Products', type: 'count', count: stats.inactive_products, filters: { is_active: 0 } },
      { name: 'Products with Pack Discount', type: 'count', count: stats.products_with_discount_pack, filters: { parent_sku_pack_discount_gt: 0 } },
    ];

    successResponse(res, { dashboard }, 'Product stats fetched successfully');
  } catch (err) {
    errorResponse(res, err.message);
  }
});

module.exports = router;
