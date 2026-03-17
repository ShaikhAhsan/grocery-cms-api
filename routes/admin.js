/**
 * Admin CRUD API - Full management of all menu and related tables
 * All routes under /api/v1/admin
 */
const express = require('express');
const router = express.Router();
const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');

const api = (table, cols, idCol = 'id') => ({
  list: async (req, res) => {
    try {
      const { limit = 500, offset = 0 } = req.query;
      const where = req.query.where ? ` WHERE ${req.query.where}` : '';
      const order = req.query.orderBy ? ` ORDER BY ${req.query.orderBy}` : ` ORDER BY ${idCol}`;
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
      res.status(500).json({ success: false, error: err.message });
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
      res.status(500).json({ success: false, error: err.message });
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

// Helper to mount CRUD for a resource
const mount = (path, table, cols, idCol = 'id') => {
  const a = api(table, cols, idCol);
  router.get(path, a.list);
  router.get(`${path}/:id`, a.get);
  router.post(path, a.create);
  router.put(`${path}/:id`, a.update);
  router.delete(`${path}/:id`, a.delete);
};

// --- CORE MENU ---
mount('/categories', 'categories', ['name', 'description', 'image_url', 'display_order', 'is_active', 'is_deleted']);
mount('/menu-items', 'menu_items', ['category_id', 'station_id', 'name', 'description', 'base_price', 'image_url', 'display_order', 'preparation_time_minutes', 'is_active', 'is_deleted']);
mount('/stations', 'stations', ['name', 'description', 'is_active']);

// --- COLLECTIONS (Promotions, Featured, Best Deals - generic titled sections) ---
mount('/collections', 'collections', ['name', 'title', 'description', 'image_url', 'display_order', 'display_style', 'is_active', 'is_deleted']);
mount('/collection-items', 'collection_items', ['collection_id', 'menu_item_id', 'display_order']);
mount('/collection-categories', 'collection_categories', ['collection_id', 'category_id', 'display_order']);

// --- VARIATIONS ---
mount('/variation-groups', 'variation_groups', ['name', 'description', 'min_selections', 'max_selections', 'is_active', 'is_deleted']);
mount('/variation-group-items', 'variation_group_items', ['variation_group_id', 'name', 'description', 'price_adjustment', 'base_price', 'station_id', 'is_product_item', 'calorie_adjustment', 'is_default', 'display_order', 'image_url', 'is_active', 'is_deleted']);
mount('/menu-item-variation-groups', 'menu_item_variation_groups', ['menu_item_id', 'variation_group_id', 'display_order']);

// --- COMBOS ---
mount('/combos', 'combos', ['station_id', 'name', 'description', 'base_price', 'image_url', 'display_order', 'is_active', 'is_deleted']);
mount('/combo-groups', 'combo_groups', ['combo_id', 'name', 'min_selections', 'max_selections', 'display_order']);
mount('/combo-group-items', 'combo_group_items', ['combo_group_id', 'menu_item_id', 'is_default', 'price_adjustment', 'display_order']);
mount('/combo-items', 'combo_items', ['combo_id', 'menu_item_id', 'min_quantity', 'max_quantity', 'display_order']);
mount('/combo-variation-rules', 'combo_variation_rules', ['combo_id', 'menu_item_id', 'variation_group_id', 'is_allowed']);

// --- COMBO RULES (upsell) ---
mount('/combo-rules', 'combo_rules', ['name', 'description', 'trigger_type', 'trigger_id', 'combo_discount_amount', 'combo_base_price', 'display_order', 'is_active']);
mount('/combo-rule-groups', 'combo_rule_groups', ['combo_rule_id', 'name', 'min_selections', 'max_selections', 'display_order']);
mount('/combo-rule-group-items', 'combo_rule_group_items', ['combo_rule_group_id', 'menu_item_id', 'is_default', 'price_adjustment', 'display_order']);

// --- PROMOTIONS ---
mount('/promotions', 'promotions', ['name', 'description', 'promotion_trigger', 'coupon_code', 'coupon_expires_at', 'max_uses_total', 'max_uses_per_customer', 'discount_type', 'discount_value', 'applicable_to', 'min_order_value', 'max_discount_amount', 'discount_on_variations', 'buy_quantity', 'get_quantity', 'get_discount_type', 'get_discount_value', 'start_date', 'end_date', 'day_of_week_mask', 'start_time', 'end_time', 'is_active', 'is_deleted']);
mount('/promotion-items', 'promotion_items', ['promotion_id', 'applicable_type', 'applicable_id']);

// --- INVENTORY ---
mount('/ingredients', 'ingredients', ['name', 'unit_of_measure', 'stock_quantity', 'reorder_level', 'is_active', 'is_deleted']);
mount('/recipe-items', 'recipe_items', ['menu_item_id', 'ingredient_id', 'quantity_used']);
mount('/stock-movements', 'stock_movements', ['ingredient_id', 'change_quantity', 'reason', 'reference_id']);

// --- DIETARY ---
mount('/dietary-tags', 'dietary_tags', ['name', 'description', 'icon_url', 'is_active']);
mount('/item-dietary-tags', 'item_dietary_tags', ['entity_type', 'entity_id', 'dietary_tag_id']);

// --- TAX ---
mount('/tax-rates', 'tax_rates', ['name', 'rate', 'is_active']);
mount('/item-tax-categories', 'item_tax_categories', ['entity_type', 'entity_id', 'tax_rate_id']);
mount('/tax-jurisdictions', 'tax_jurisdictions', ['country', 'state', 'city', 'tax_rate_id']);

// --- CUSTOMER & LOYALTY ---
mount('/customer-groups', 'customer_groups', ['name', 'description', 'is_active']);
mount('/customer-group-prices', 'customer_group_prices', ['customer_group_id', 'menu_item_id', 'special_price']);
mount('/loyalty-points-rules', 'loyalty_points_rules', ['entity_type', 'entity_id', 'points_per_unit']);

// --- MENU VERSIONING ---
mount('/menu-versions', 'menu_versions', ['name', 'description', 'start_date', 'end_date', 'is_active']);
mount('/menu-version-items', 'menu_version_items', ['menu_version_id', 'menu_item_id', 'override_price', 'is_visible']);

// --- ADVANCED ---
mount('/modifier-rules', 'modifier_rules', ['rule_type', 'condition_group_id', 'condition_item_id', 'target_group_id', 'target_item_id']);
mount('/variation-group-dependencies', 'variation_group_dependencies', ['parent_variation_group_item_id', 'child_variation_group_id', 'display_order']);
mount('/variation-group-item-price-context', 'variation_group_item_price_context', ['variation_group_item_id', 'context_variation_group_item_id', 'price_adjustment']);
mount('/item-station-routing', 'item_station_routing', ['entity_type', 'entity_id', 'station_id']);
mount('/availability-schedules', 'availability_schedules', ['entity_type', 'entity_id', 'day_of_week_mask', 'start_time', 'end_time', 'start_date', 'end_date', 'is_active']);
mount('/seo-metadata', 'seo_metadata', ['entity_type', 'entity_id', 'meta_title', 'meta_description', 'meta_keywords', 'slug']);
mount('/images', 'images', ['entity_type', 'entity_id', 'image_url', 'alt_text', 'display_order', 'is_primary']);

// --- AUDIT (read-only) ---
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
