/**
 * Image routes - map product images from uploads folder to products table
 */
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');
const { processImageUrl } = require('../utils/helpers');

const router = express.Router();

/** Public base for files under uploads/ (image microservice / static host). */
function productUploadsPublicBase() {
  return (
    process.env.PRODUCT_UPLOADS_PUBLIC_BASE_URL ||
    process.env.UPLOAD_MICROSERVICE_URL ||
    'http://109.106.244.241:9007'
  ).replace(/\/$/, '');
}

function absoluteUploadUrl(relativePath) {
  if (!relativePath) return null;
  const rel = String(relativePath).replace(/^\//, '');
  const base = productUploadsPublicBase();
  return `${base}/${rel}`;
}

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

/**
 * GET /images/from-uploads?sku=...
 * If the product row has no image, looks for uploads/products/{sku}.{ext} (and thumbs/) on disk
 * and returns full URLs under the public host (e.g. http://109.106.244.241:9007/uploads/products/...).
 */
router.get('/from-uploads', async (req, res) => {
  try {
    const sku = String(req.query.sku ?? '').trim();
    if (!sku) {
      return res.status(400).json({
        success: false,
        error: 'Query parameter sku is required',
      });
    }

    const rows = await sequelize.query(
      'SELECT product_id, sku, image, thumb_image FROM products WHERE sku = ? LIMIT 1',
      { type: QueryTypes.SELECT, replacements: [sku] }
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'Product not found for this SKU' });
    }

    const row = rows[0];
    const dbImage = row.image != null && String(row.image).trim() !== '' ? String(row.image).trim() : null;
    const dbThumb =
      row.thumb_image != null && String(row.thumb_image).trim() !== ''
        ? String(row.thumb_image).trim()
        : null;
    const dbHasImage = !!(dbImage || dbThumb);

    const base = productUploadsPublicBase();

    if (dbHasImage) {
      return res.json({
        success: true,
        sku: row.sku,
        product_id: row.product_id,
        db_has_image: true,
        image_in_db: dbImage,
        thumb_in_db: dbThumb,
        image_url: processImageUrl(dbImage, base) || absoluteUploadUrl(dbImage),
        thumb_url: processImageUrl(dbThumb, base) || absoluteUploadUrl(dbThumb),
        found_in_uploads: false,
        uploads_image_url: null,
        uploads_thumb_url: null,
        message: 'Product already has image path(s) in the database',
      });
    }

    const productsDir = path.join(process.cwd(), 'uploads', 'products');
    let files = [];
    try {
      files = await fs.readdir(productsDir);
    } catch (_err) {
      return res.json({
        success: true,
        sku: row.sku,
        product_id: row.product_id,
        db_has_image: false,
        found_in_uploads: false,
        uploads_image_url: null,
        uploads_thumb_url: null,
        public_base: base,
        message: 'No image in DB and uploads/products directory is missing or not readable',
      });
    }

    const skuNorm = sku.toLowerCase();
    const fileName = files.find((f) => {
      if (f === 'thumbs') return false;
      const ext = path.extname(f).toLowerCase();
      if (!IMAGE_EXT.has(ext)) return false;
      const baseName = path.parse(f).name;
      return baseName === sku || baseName.toLowerCase() === skuNorm;
    });

    if (!fileName) {
      return res.json({
        success: true,
        sku: row.sku,
        product_id: row.product_id,
        db_has_image: false,
        found_in_uploads: false,
        uploads_image_url: null,
        uploads_thumb_url: null,
        public_base: base,
        message: `No image in DB and no matching file in uploads/products for SKU "${sku}"`,
      });
    }

    const relImage = `uploads/products/${fileName}`;
    const thumbFsPath = path.join(productsDir, 'thumbs', fileName);
    let thumbExists = false;
    try {
      await fs.access(thumbFsPath);
      thumbExists = true;
    } catch (_e) {
      thumbExists = false;
    }
    const relThumb = thumbExists ? `uploads/products/thumbs/${fileName}` : null;

    return res.json({
      success: true,
      sku: row.sku,
      product_id: row.product_id,
      db_has_image: false,
      found_in_uploads: true,
      file_name: fileName,
      public_base: base,
      uploads_image_url: absoluteUploadUrl(relImage),
      uploads_thumb_url: relThumb ? absoluteUploadUrl(relThumb) : null,
      relative_image: relImage,
      relative_thumb: relThumb,
      message: 'Image found on disk; URLs use public_base + relative path',
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

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
