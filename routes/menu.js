const express = require('express');
const router = express.Router();
const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');

// GET /api/v1/menu/stations - all stations (for KDS/order routing)
router.get('/stations', async (req, res) => {
  try {
    const stations = await sequelize.query(
      `SELECT id, name, description, is_active FROM stations WHERE is_active = 1 ORDER BY name`,
      { type: QueryTypes.SELECT }
    );
    res.json({ success: true, data: stations });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v1/menu/categories - all categories with item counts
router.get('/categories', async (req, res) => {
  try {
    const categories = await sequelize.query(
      `SELECT c.id, c.name, c.description, c.image_url, c.display_order,
              (SELECT COUNT(*) FROM menu_items m WHERE m.category_id = c.id AND m.is_active = 1 AND m.is_deleted = 0) as item_count
       FROM categories c
       WHERE c.is_active = 1 AND c.is_deleted = 0
       ORDER BY c.display_order, c.name`,
      { type: QueryTypes.SELECT }
    );
    res.json({ success: true, data: categories });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v1/menu/items - menu items by category (optional ?categoryId=)
router.get('/items', async (req, res) => {
  try {
    const { categoryId } = req.query;
    let sql = `
      SELECT m.id, m.category_id, m.name, m.description, m.base_price, m.image_url, m.display_order, m.preparation_time_minutes
      FROM menu_items m
      WHERE m.is_active = 1 AND m.is_deleted = 0
    `;
    const replacements = {};
    if (categoryId) {
      sql += ' AND m.category_id = :categoryId';
      replacements.categoryId = categoryId;
    }
    sql += ' ORDER BY m.display_order, m.name';

    const items = await sequelize.query(sql, {
      type: QueryTypes.SELECT,
      replacements: Object.keys(replacements).length ? replacements : undefined,
    });

    const itemsWithVariations = await Promise.all(
      items.map(async (item) => {
        const vgRows = await sequelize.query(
          `SELECT vg.id as variation_group_id, vg.name as variation_group_name, vg.min_selections, vg.max_selections, vg.description
           FROM menu_item_variation_groups mivg
           JOIN variation_groups vg ON vg.id = mivg.variation_group_id
           WHERE mivg.menu_item_id = :menuItemId AND vg.is_active = 1 AND vg.is_deleted = 0
           ORDER BY mivg.display_order`,
          { type: QueryTypes.SELECT, replacements: { menuItemId: item.id } }
        );

        const variationGroups = await Promise.all(
          vgRows.map(async (vg) => {
            const vgiRows = await sequelize.query(
              `SELECT id, name, description, price_adjustment, is_default, display_order
               FROM variation_group_items
               WHERE variation_group_id = :vgId AND is_active = 1 AND is_deleted = 0
               ORDER BY display_order, name`,
              { type: QueryTypes.SELECT, replacements: { vgId: vg.variation_group_id } }
            );
            return { ...vg, items: vgiRows };
          })
        );

        return { ...item, variation_groups: variationGroups };
      })
    );

    res.json({ success: true, data: itemsWithVariations });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v1/menu/combos - all combos with their items
router.get('/combos', async (req, res) => {
  try {
    const combos = await sequelize.query(
      `SELECT id, name, description, base_price, image_url, display_order
       FROM combos WHERE is_active = 1 AND is_deleted = 0
       ORDER BY display_order, name`,
      { type: QueryTypes.SELECT }
    );

    const combosWithItems = await Promise.all(
      combos.map(async (combo) => {
        const items = await sequelize.query(
          `SELECT ci.id, ci.menu_item_id, ci.min_quantity, ci.max_quantity, m.name as menu_item_name
           FROM combo_items ci JOIN menu_items m ON m.id = ci.menu_item_id
           WHERE ci.combo_id = :comboId ORDER BY ci.display_order`,
          { type: QueryTypes.SELECT, replacements: { comboId: combo.id } }
        );
        return { ...combo, items };
      })
    );

    res.json({ success: true, data: combosWithItems });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v1/menu/full - full menu (stub until DB is ready)
router.get('/full', async (req, res) => {
  try {
    const categories = await sequelize.query(
      `SELECT id, name, description, image_url, display_order FROM categories
       WHERE is_active = 1 AND is_deleted = 0 ORDER BY display_order, name`,
      { type: QueryTypes.SELECT }
    ).catch(() => []);

    const items = await sequelize.query(
      `SELECT m.id, m.category_id, m.name, m.description, m.base_price, m.image_url, m.display_order, m.preparation_time_minutes,
              m.station_id, s.name as station_name
       FROM menu_items m LEFT JOIN stations s ON s.id = m.station_id
       WHERE m.is_active = 1 AND m.is_deleted = 0
       ORDER BY m.category_id, m.display_order, m.name`,
      { type: QueryTypes.SELECT }
    ).catch(() => []);

    const mivg = await sequelize.query(
      `SELECT mivg.menu_item_id, vg.id as vg_id, vg.name as vg_name, vg.min_selections, vg.max_selections, vg.description as vg_description, mivg.display_order as vg_order
       FROM menu_item_variation_groups mivg
       JOIN variation_groups vg ON vg.id = mivg.variation_group_id
       WHERE vg.is_active = 1 AND vg.is_deleted = 0 ORDER BY mivg.menu_item_id, mivg.display_order`,
      { type: QueryTypes.SELECT }
    ).catch(() => []);

    const vgi = await sequelize.query(
      `SELECT vgi.variation_group_id, vgi.id, vgi.name, vgi.description, vgi.price_adjustment, vgi.base_price, vgi.station_id, vgi.is_product_item, vgi.is_default, vgi.display_order, s.name as station_name
       FROM variation_group_items vgi
       JOIN variation_groups vg ON vg.id = vgi.variation_group_id
       LEFT JOIN stations s ON s.id = vgi.station_id
       WHERE vg.is_active = 1 AND vg.is_deleted = 0 AND vgi.is_active = 1 AND vgi.is_deleted = 0
       ORDER BY vgi.variation_group_id, vgi.display_order, vgi.name`,
      { type: QueryTypes.SELECT }
    ).catch(() => []);

    let vgDeps = [];
    try {
      vgDeps = await sequelize.query(`SELECT vgd.parent_variation_group_item_id, vgd.child_variation_group_id FROM variation_group_dependencies vgd`, { type: QueryTypes.SELECT });
    } catch (_) {}

    const depsByParent = {};
    vgDeps.forEach((d) => {
      if (!depsByParent[d.parent_variation_group_item_id]) depsByParent[d.parent_variation_group_item_id] = [];
      depsByParent[d.parent_variation_group_item_id].push(d.child_variation_group_id);
    });

    const vgiByVg = {};
    vgi.forEach((row) => {
      if (!vgiByVg[row.variation_group_id]) vgiByVg[row.variation_group_id] = [];
      const childVgIds = depsByParent[row.id] || [];
      const dependent_groups = childVgIds.length ? childVgIds.map((cvgId) => {
        const childItems = vgi.filter((v) => v.variation_group_id === cvgId).map(({ variation_group_id, ...rest }) => rest);
        return { id: cvgId, items: childItems };
      }) : undefined;
      vgiByVg[row.variation_group_id].push({ ...row, dependent_groups });
    });

    const vgMeta = await sequelize.query(
      `SELECT id, name, description, min_selections, max_selections FROM variation_groups WHERE is_active = 1 AND is_deleted = 0`,
      { type: QueryTypes.SELECT }
    ).catch(() => []);
    const vgMetaById = (vgMeta || []).reduce((a, r) => ({ ...a, [r.id]: r }), {});

    vgi.forEach((row) => {
      const arr = vgiByVg[row.variation_group_id];
      const idx = arr?.findIndex((x) => x.id === row.id);
      if (idx >= 0 && (depsByParent[row.id] || []).length > 0) {
        const childVgIds = depsByParent[row.id];
        arr[idx].dependent_groups = childVgIds.map((cvgId) => {
          const meta = vgMetaById[cvgId] || {};
          const childItems = vgi.filter((v) => v.variation_group_id === cvgId).map(({ variation_group_id, ...rest }) => rest);
          return { id: cvgId, ...meta, items: childItems };
        });
      }
    });

    const mivgByItem = {};
    mivg.forEach((row) => {
      if (!mivgByItem[row.menu_item_id]) mivgByItem[row.menu_item_id] = [];
      mivgByItem[row.menu_item_id].push({
        id: row.vg_id,
        name: row.vg_name,
        min_selections: row.min_selections,
        max_selections: row.max_selections,
        description: row.vg_description,
        items: vgiByVg[row.vg_id] || [],
      });
    });

    const itemsByCat = {};
    items.forEach((item) => {
      const vgs = mivgByItem[item.id] || [];
      if (!itemsByCat[item.category_id]) itemsByCat[item.category_id] = [];
      itemsByCat[item.category_id].push({ ...item, variation_groups: vgs });
    });

    const result = categories.map((cat) => ({ ...cat, items: itemsByCat[cat.id] || [] }));

    const combosRaw = await sequelize.query(
      `SELECT c.id, c.name, c.description, c.base_price, c.image_url, c.display_order, c.station_id, s.name as station_name
       FROM combos c LEFT JOIN stations s ON s.id = c.station_id
       WHERE c.is_active = 1 AND c.is_deleted = 0 ORDER BY c.display_order, c.name`,
      { type: QueryTypes.SELECT }
    ).catch(() => []);

    const combos = await Promise.all((combosRaw || []).map(async (c) => {
      const groups = await sequelize.query(
        `SELECT id, name, min_selections, max_selections, display_order FROM combo_groups WHERE combo_id = :id ORDER BY display_order`,
        { type: QueryTypes.SELECT, replacements: { id: c.id } }
      ).catch(() => []);

      if (groups.length > 0) {
        const groupsWithItems = await Promise.all(groups.map(async (g) => {
          const gItems = await sequelize.query(
            `SELECT cgi.id, cgi.menu_item_id, cgi.is_default, cgi.price_adjustment, cgi.display_order,
                    m.name as menu_item_name, m.base_price as menu_item_base_price, m.description as menu_item_description,
                    m.station_id, s.name as station_name
             FROM combo_group_items cgi JOIN menu_items m ON m.id = cgi.menu_item_id
             LEFT JOIN stations s ON s.id = m.station_id
             WHERE cgi.combo_group_id = :gid ORDER BY cgi.display_order, m.name`,
            { type: QueryTypes.SELECT, replacements: { gid: g.id } }
          );
          return { ...g, items: gItems };
        }));
        return { ...c, groups: groupsWithItems };
      }

      const legacyItems = await sequelize.query(
        `SELECT ci.menu_item_id, ci.min_quantity, ci.max_quantity, m.name as menu_item_name
         FROM combo_items ci JOIN menu_items m ON m.id = ci.menu_item_id
         WHERE ci.combo_id = :id ORDER BY ci.display_order`,
        { type: QueryTypes.SELECT, replacements: { id: c.id } }
      ).catch(() => []);
      return { ...c, items: legacyItems };
    }));

    const stations = await sequelize.query(
      `SELECT id, name, description FROM stations WHERE is_active = 1 ORDER BY name`,
      { type: QueryTypes.SELECT }
    ).catch(() => []);

    let comboRulesRaw = [];
    try {
      comboRulesRaw = await sequelize.query(
        `SELECT id, name, description, trigger_type, trigger_id, combo_discount_amount, combo_base_price, display_order
         FROM combo_rules WHERE is_active = 1 ORDER BY display_order`,
        { type: QueryTypes.SELECT }
      );
    } catch (_) {}

    const comboRulesWithGroups = await Promise.all((comboRulesRaw || []).map(async (cr) => {
      const groups = await sequelize.query(
        `SELECT id, name, min_selections, max_selections, display_order FROM combo_rule_groups WHERE combo_rule_id = :id ORDER BY display_order`,
        { type: QueryTypes.SELECT, replacements: { id: cr.id } }
      ).catch(() => []);
      const groupsWithItems = await Promise.all((groups || []).map(async (g) => {
        const gItems = await sequelize.query(
          `SELECT crgi.id, crgi.menu_item_id, crgi.is_default, crgi.price_adjustment, crgi.display_order,
                  m.name as menu_item_name, m.base_price as menu_item_base_price
           FROM combo_rule_group_items crgi JOIN menu_items m ON m.id = crgi.menu_item_id
           WHERE crgi.combo_rule_group_id = :gid ORDER BY crgi.display_order, m.name`,
          { type: QueryTypes.SELECT, replacements: { gid: g.id } }
        );
        return { ...g, items: gItems || [] };
      }));
      return { ...cr, groups: groupsWithItems };
    }));

    const comboRulesByMenuItem = {};
    const comboRulesByCategory = {};
    (comboRulesWithGroups || []).forEach((cr) => {
      if (cr.trigger_type === 'menu_item') comboRulesByMenuItem[cr.trigger_id] = cr;
      else comboRulesByCategory[cr.trigger_id] = cr;
    });

    let promotions = [];
    try {
      promotions = await sequelize.query(
        `SELECT p.* FROM promotions p
         WHERE p.is_active = 1 AND p.is_deleted = 0
         AND (p.start_date IS NULL OR p.start_date <= NOW())
         AND (p.end_date IS NULL OR p.end_date >= NOW())
         ORDER BY p.start_date, p.name`,
        { type: QueryTypes.SELECT }
      );
      const promWithItems = await Promise.all((promotions || []).map(async (p) => {
        const pItems = await sequelize.query(
          `SELECT applicable_type, applicable_id FROM promotion_items WHERE promotion_id = :id`,
          { type: QueryTypes.SELECT, replacements: { id: p.id } }
        );
        return { ...p, applicable_items: pItems || [] };
      }));
      promotions = promWithItems;
    } catch (_) {}

    let collections = [];
    try {
      let collectionsRaw = [];
      try {
        collectionsRaw = await sequelize.query(
          `SELECT id, name, title, description, image_url, display_order, display_style FROM collections WHERE is_active = 1 AND is_deleted = 0 ORDER BY display_order, title`,
          { type: QueryTypes.SELECT }
        );
      } catch (_) {
        collectionsRaw = await sequelize.query(
          `SELECT id, name, title, description, image_url, display_order FROM collections WHERE is_active = 1 AND is_deleted = 0 ORDER BY display_order, title`,
          { type: QueryTypes.SELECT }
        );
      }
      const itemsById = {};
      items.forEach((item) => { itemsById[item.id] = { ...item, variation_groups: mivgByItem[item.id] || [] }; });
      const categoriesById = (result || []).reduce((a, c) => ({ ...a, [c.id]: c }), {});
      collections = await Promise.all((collectionsRaw || []).map(async (col) => {
        const ci = await sequelize.query(`SELECT menu_item_id, display_order FROM collection_items WHERE collection_id = :id ORDER BY display_order, id`, { type: QueryTypes.SELECT, replacements: { id: col.id } }).catch(() => []);
        let cc = [];
        try {
          cc = await sequelize.query(`SELECT category_id, display_order FROM collection_categories WHERE collection_id = :id ORDER BY display_order, id`, { type: QueryTypes.SELECT, replacements: { id: col.id } });
        } catch (_) {}
        const colItems = (ci || []).map((r) => itemsById[r.menu_item_id]).filter(Boolean).sort((a, b) => {
          const orderA = ci.find((x) => x.menu_item_id === a.id)?.display_order ?? 0;
          const orderB = ci.find((x) => x.menu_item_id === b.id)?.display_order ?? 0;
          return orderA - orderB;
        });
        const colCategories = (cc || []).map((r) => categoriesById[r.category_id]).filter(Boolean).sort((a, b) => {
          const orderA = cc.find((x) => x.category_id === a.id)?.display_order ?? 0;
          const orderB = cc.find((x) => x.category_id === b.id)?.display_order ?? 0;
          return orderA - orderB;
        });
        return { ...col, items: colItems, categories: colCategories, display_style: col.display_style || 'horizontal_scroll' };
      }));
    } catch (_) {}

    res.json({
      success: true,
      data: result,
      combos,
      stations,
      combo_rules: { by_menu_item: comboRulesByMenuItem, by_category: comboRulesByCategory },
      promotions: promotions || [],
      collections: collections || [],
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
