/**
 * Image routes - map product images from uploads folder to products table
 */
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');

const router = express.Router();

router.post('/map', async (req, res) => {
  try {
    const productsDir = path.join(process.cwd(), 'uploads', 'products');
    let files = [];
    try {
      files = await fs.readdir(productsDir);
    } catch (err) {
      return res.json({ status: 'success', updatedCount: 0, updatedSkus: [], message: 'Uploads directory not found' });
    }

    files = files.filter((f) => {
      const lower = f.toLowerCase();
      return f !== 'thumbs' && (lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png') || lower.endsWith('.gif'));
    });

    const updates = [];
    for (const fileName of files) {
      const sku = path.parse(fileName).name;
      const imagePath = `uploads/products/${fileName}`;
      const thumbImagePath = `uploads/products/thumbs/${fileName}`;

      const rows = await sequelize.query('SELECT image FROM products WHERE sku = ? LIMIT 1', {
        type: QueryTypes.SELECT,
        replacements: [sku],
      });
      if (rows.length === 0) continue;

      const currentImage = rows[0]?.image;
      if (!currentImage) {
        await sequelize.query('UPDATE products SET image = ?, thumb_image = ? WHERE sku = ?', {
          replacements: [imagePath, thumbImagePath, sku],
        });
        updates.push(sku);
      }
    }

    res.json({ status: 'success', updatedCount: updates.length, updatedSkus: updates });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;
