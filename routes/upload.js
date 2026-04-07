/**
 * Upload routes — POST /upload (multipart) for product/category images (updates DB).
 * Brand images use the external microservice / upload-microservice proxy, not this file.
 */
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');
const { uploadToGCS, isGCSAvailable } = require('../services/googleCloudStorage');

const router = express.Router();
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const dest = path.join(UPLOAD_DIR, 'temp');
    await fs.mkdir(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

router.post('/', upload.single('image'), async (req, res) => {
  try {
    const { type, id } = req.body;
    const file = req.file;

    if (!type || !id) {
      return res.status(400).json({ status: 'error', message: 'Type and ID are required.' });
    }
    if (!file) {
      return res.status(400).json({ status: 'error', message: 'No image file provided.' });
    }

    const allowedTypes = ['product', 'category'];
    if (!allowedTypes.includes(type)) {
      return res.status(400).json({ status: 'error', message: "Invalid type. Must be 'product' or 'category'." });
    }

    let originalPath, thumbPath;

    if (isGCSAvailable()) {
      const buffer = await fs.readFile(file.path);
      const folder = type === 'product' ? 'products' : 'categories';
      const fileName = `${type}-${id}${path.extname(file.originalname)}`;
      const { url } = await uploadToGCS(buffer, fileName, folder, file.mimetype || 'image/jpeg');
      await fs.unlink(file.path).catch(() => {});
      originalPath = url;
      thumbPath = url;
    } else {
      const baseDir = path.join(UPLOAD_DIR, type === 'product' ? 'products' : 'categories');
      await fs.mkdir(path.join(baseDir, 'thumbs'), { recursive: true });
      const ext = path.extname(file.originalname) || '.jpg';
      const fileName = `${id}${ext}`;
      originalPath = path.join(baseDir, fileName);
      thumbPath = path.join(baseDir, 'thumbs', fileName);
      await fs.copyFile(file.path, originalPath);
      await fs.copyFile(file.path, thumbPath);
      await fs.unlink(file.path).catch(() => {});
      originalPath = `uploads/${type === 'product' ? 'products' : 'categories'}/${fileName}`;
      thumbPath = `uploads/${type === 'product' ? 'products' : 'categories'}/thumbs/${fileName}`;
    }

    const tableMap = { product: { table: 'products', idColumn: 'sku' }, category: { table: 'categories', idColumn: 'category_id' } };
    const { table, idColumn } = tableMap[type];
    await sequelize.query(
      `UPDATE \`${table}\` SET image = ?, thumb_image = ? WHERE \`${idColumn}\` = ?`,
      { replacements: [originalPath, thumbPath, id] }
    );

    res.json({
      status: 'success',
      message: 'Image uploaded successfully.',
      original_image_path: originalPath,
      thumb_image_path: thumbPath,
    });
  } catch (error) {
    if (req.file?.path) await fs.unlink(req.file.path).catch(() => {});
    res.status(500).json({ status: 'error', message: error.message });
  }
});

module.exports = router;
