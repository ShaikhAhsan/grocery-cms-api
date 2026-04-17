/**
 * Categories API - CRUD, hierarchy, relationships
 */
const express = require('express');
const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');
const { successResponse, errorResponse } = require('../utils/responseHandler');
const { processImageUrl } = require('../utils/helpers');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const includeAll = req.query.include_inactive === 'true' || req.query.include_inactive === '1';
    let query = `
      SELECT category_id, category_name, category_description, image, thumb_image, seo_title, seo_description, seo_content, slug,
             position, created_at, updated_at, is_active
      FROM categories
    `;
    if (!includeAll) query += ' WHERE is_active = 1';
    query += ' ORDER BY position ASC';

    const categories = await sequelize.query(query, { type: QueryTypes.SELECT });
    const processed = categories.map((c) => ({
      ...c,
      image: processImageUrl(c.image),
      thumb_image: processImageUrl(c.thumb_image),
    }));
    successResponse(res, processed, 'Categories fetched successfully');
  } catch (err) {
    errorResponse(res, err);
  }
});

router.get('/:id', async (req, res) => {
  try {
    const [categories] = await sequelize.query(
      `SELECT * FROM categories WHERE category_id = ? ${req.query.include_inactive ? '' : 'AND is_active = 1'}`,
      { type: QueryTypes.SELECT, replacements: [req.params.id] }
    );
    if (categories.length === 0) return errorResponse(res, 'Category not found', 404);

    const [subCategories] = await sequelize.query(
      `SELECT c.* FROM categories c
       JOIN category_relationships cr ON c.category_id = cr.child_id
       WHERE cr.parent_id = ? ${req.query.include_inactive ? '' : 'AND c.is_active = 1'}
       ORDER BY cr.position ASC`,
      { type: QueryTypes.SELECT, replacements: [req.params.id] }
    );

    const category = {
      ...categories[0],
      image: processImageUrl(categories[0].image),
      subCategories: subCategories.map((sc) => ({ ...sc, image: processImageUrl(sc.image) })),
    };
    successResponse(res, category, 'Category fetched successfully');
  } catch (err) {
    errorResponse(res, err);
  }
});

router.post('/upsert', async (req, res) => {
  try {
    const { category_id, category_name, category_description, image, is_active = true, position = 0 } = req.body;
    if (!category_name) return errorResponse(res, 'Category name is required', 400);

    if (category_id) {
      await sequelize.query(
        `UPDATE categories SET category_name = ?, category_description = ?, image = ?, is_active = ?, position = ?, updated_at = CURRENT_TIMESTAMP WHERE category_id = ?`,
        { replacements: [category_name, category_description, image, is_active ? 1 : 0, position, category_id] }
      );
      const [updated] = await sequelize.query('SELECT * FROM categories WHERE category_id = ?', {
        type: QueryTypes.SELECT,
        replacements: [category_id],
      });
      successResponse(res, updated[0], 'Category updated successfully');
    } else {
      await sequelize.query(
        `INSERT INTO categories (category_name, category_description, image, is_active, position) VALUES (?, ?, ?, ?, ?)`,
        { replacements: [category_name, category_description, image, is_active ? 1 : 0, position] }
      );
      const [rows] = await sequelize.query('SELECT LAST_INSERT_ID() as id', { type: QueryTypes.SELECT });
      const id = rows[0]?.id;
      const newCat = await sequelize.query('SELECT * FROM categories WHERE category_id = ?', {
        type: QueryTypes.SELECT,
        replacements: [id],
      });
      successResponse(res, newCat[0], 'Category created successfully', 201);
    }
  } catch (err) {
    errorResponse(res, err);
  }
});

router.post('/:id/relationships', async (req, res) => {
  try {
    const { id } = req.params;
    const { child_ids } = req.body;

    const parentCheck = await sequelize.query('SELECT 1 FROM categories WHERE category_id = ?', {
      type: QueryTypes.SELECT,
      replacements: [id],
    });
    if (parentCheck.length === 0) return errorResponse(res, 'Parent category not found', 404);

    if (child_ids && child_ids.length > 0) {
      const placeholders = child_ids.map(() => '?').join(',');
      const check = await sequelize.query(
        `SELECT COUNT(*) as count FROM categories WHERE category_id IN (${placeholders})`,
        { type: QueryTypes.SELECT, replacements: child_ids }
      );
      if ((check[0]?.count ?? 0) !== child_ids.length) return errorResponse(res, 'One or more child categories not found', 404);
    }

    await sequelize.transaction(async (t) => {
      await sequelize.query('DELETE FROM category_relationships WHERE parent_id = ?', {
        replacements: [id],
        transaction: t,
      });
      if (child_ids && child_ids.length > 0) {
        for (let i = 0; i < child_ids.length; i++) {
          await sequelize.query(
            'INSERT INTO category_relationships (parent_id, child_id, position) VALUES (?, ?, ?)',
            { replacements: [id, child_ids[i], i], transaction: t }
          );
        }
      }
    });
    successResponse(res, null, 'Category relationships updated successfully');
  } catch (err) {
    errorResponse(res, err);
  }
});

router.patch('/:id/status', async (req, res) => {
  try {
    const { is_active } = req.body;
    if (typeof is_active !== 'boolean') return errorResponse(res, 'is_active must be a boolean', 400);
    await sequelize.query(
      'UPDATE categories SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE category_id = ?',
      { replacements: [is_active ? 1 : 0, req.params.id] }
    );
    successResponse(res, null, 'Category status updated successfully');
  } catch (err) {
    errorResponse(res, err);
  }
});

router.patch('/:id/position', async (req, res) => {
  try {
    const { position } = req.body;
    if (typeof position !== 'number') return errorResponse(res, 'position must be a number', 400);
    await sequelize.query(
      'UPDATE categories SET position = ?, updated_at = CURRENT_TIMESTAMP WHERE category_id = ?',
      { replacements: [position, req.params.id] }
    );
    successResponse(res, null, 'Category position updated successfully');
  } catch (err) {
    errorResponse(res, err);
  }
});

router.get('/search', async (req, res) => {
  try {
    const { keyword } = req.query;
    if (!keyword) return errorResponse(res, 'Search keyword is required', 400);
    const includeAll = req.query.include_inactive === 'true' || req.query.include_inactive === '1';
    const likePattern = `%${keyword}%`;
    const categories = await sequelize.query(
      `SELECT category_id, category_name, category_description, image, thumb_image, seo_title, seo_description, seo_content, slug,
              position, created_at, updated_at, is_active
       FROM categories
       WHERE (category_name LIKE ? OR category_description LIKE ?) ${includeAll ? '' : 'AND is_active = 1'}
       ORDER BY position ASC, category_name ASC`,
      { type: QueryTypes.SELECT, replacements: [likePattern, likePattern] }
    );
    const processed = categories.map((c) => ({ ...c, image: processImageUrl(c.image) }));
    successResponse(res, processed, 'Search results fetched successfully');
  } catch (err) {
    errorResponse(res, err);
  }
});

router.get('/:parent_id/subcategories', async (req, res) => {
  try {
    const { parent_id } = req.params;
    const [parent] = await sequelize.query('SELECT 1 FROM categories WHERE category_id = ?', {
      type: QueryTypes.SELECT,
      replacements: [parent_id],
    });
    if (parent.length === 0) return errorResponse(res, 'Parent category not found', 404);

    const subcategories = await sequelize.query(
      `SELECT c.* FROM categories c
       JOIN category_relationships cr ON c.category_id = cr.child_id
       WHERE cr.parent_id = ?
       ORDER BY cr.position ASC`,
      { type: QueryTypes.SELECT, replacements: [parent_id] }
    );
    const processed = subcategories.map((c) => ({ ...c, image: processImageUrl(c.image) }));
    successResponse(res, processed, 'Subcategories fetched successfully');
  } catch (err) {
    errorResponse(res, err);
  }
});

router.get('/:category_id/parents', async (req, res) => {
  try {
    const { category_id } = req.params;
    const [category] = await sequelize.query('SELECT 1 FROM categories WHERE category_id = ?', {
      type: QueryTypes.SELECT,
      replacements: [category_id],
    });
    if (category.length === 0) return errorResponse(res, 'Category not found', 404);

    const parents = await sequelize.query(
      `SELECT c.* FROM categories c
       JOIN category_relationships cr ON c.category_id = cr.parent_id
       WHERE cr.child_id = ?
       ORDER BY cr.position ASC`,
      { type: QueryTypes.SELECT, replacements: [category_id] }
    );
    const processed = parents.map((c) => ({ ...c, image: processImageUrl(c.image) }));
    successResponse(res, processed, 'Parent categories fetched successfully');
  } catch (err) {
    errorResponse(res, err);
  }
});

router.post('/relationships', async (req, res) => {
  try {
    const { parent_id, child_id } = req.body;
    const [[p], [c]] = await Promise.all([
      sequelize.query('SELECT 1 FROM categories WHERE category_id = ?', { type: QueryTypes.SELECT, replacements: [parent_id] }),
      sequelize.query('SELECT 1 FROM categories WHERE category_id = ?', { type: QueryTypes.SELECT, replacements: [child_id] }),
    ]);
    if (!p?.length || !c?.length) return errorResponse(res, 'Parent or child category not found', 404);

    const [existing] = await sequelize.query(
      'SELECT 1 FROM category_relationships WHERE parent_id = ? AND child_id = ?',
      { type: QueryTypes.SELECT, replacements: [parent_id, child_id] }
    );
    if (existing.length > 0) return errorResponse(res, 'Relationship already exists', 400);

    const [[{ maxPos }]] = await sequelize.query(
      'SELECT COALESCE(MAX(position), 0) as maxPos FROM category_relationships WHERE parent_id = ?',
      { type: QueryTypes.SELECT, replacements: [parent_id] }
    );
    await sequelize.query(
      'INSERT INTO category_relationships (parent_id, child_id, position) VALUES (?, ?, ?)',
      { replacements: [parent_id, child_id, (maxPos?.maxPos ?? 0) + 1] }
    );
    successResponse(res, null, 'Relationship added successfully', 201);
  } catch (err) {
    errorResponse(res, err);
  }
});

router.delete('/relationships', async (req, res) => {
  try {
    const { parent_id, child_id } = req.body;
    const [result] = await sequelize.query(
      'DELETE FROM category_relationships WHERE parent_id = ? AND child_id = ?',
      { replacements: [parent_id, child_id] }
    );
    if (result?.affectedRows === 0) return errorResponse(res, 'Relationship not found', 404);
    successResponse(res, null, 'Relationship removed successfully');
  } catch (err) {
    errorResponse(res, err);
  }
});

router.post('/:categoryId/products', async (req, res) => {
  try {
    const { categoryId } = req.params;
    const { products } = req.body;
    if (!Array.isArray(products) || products.length === 0) {
      return errorResponse(res, 'Array of product IDs is required', 400);
    }
    let inserted = 0;
    for (let i = 0; i < products.length; i++) {
      try {
        await sequelize.query(
          'INSERT IGNORE INTO product_categories (category_id, product_id, position) VALUES (?, ?, ?)',
          { replacements: [categoryId, products[i], i + 1] }
        );
        inserted++;
      } catch {}
    }
    successResponse(res, { inserted, ignored: products.length - inserted }, 'Products added successfully (duplicates ignored)');
  } catch (err) {
    errorResponse(res, err);
  }
});

router.delete('/:categoryId/products', async (req, res) => {
  try {
    const { categoryId } = req.params;
    const { products } = req.body;
    if (!Array.isArray(products) || products.length === 0) {
      return errorResponse(res, 'Array of product IDs is required', 400);
    }
    const placeholders = products.map(() => '?').join(',');
    const [result] = await sequelize.query(
      `DELETE FROM product_categories WHERE category_id = ? AND product_id IN (${placeholders})`,
      { replacements: [categoryId, ...products] }
    );
    if (result?.affectedRows === 0) return errorResponse(res, 'No matching products found in category', 404);
    successResponse(res, { affectedRows: result.affectedRows }, 'Products removed from category');
  } catch (err) {
    errorResponse(res, err);
  }
});

module.exports = router;
