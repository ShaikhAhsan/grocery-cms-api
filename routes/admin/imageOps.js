const express = require('express');
const http = require('http');
const https = require('https');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const { sequelize } = require('../../config/database');
const { QueryTypes } = require('sequelize');
const { publicApiErrorMessage } = require('../../utils/publicApiErrorMessage');

const router = express.Router();

const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const uploadMicroserviceBase = (
  process.env.UPLOAD_MICROSERVICE_URL || 'http://109.106.244.241:9007'
).replace(/\/$/, '');
const MAX_FETCH_IMAGE_BYTES = 15 * 1024 * 1024;
const imageImportHttpAgent = new http.Agent({ keepAlive: true, maxSockets: 50 });
const imageImportHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50 });
const IMAGE_IMPORT_USER_AGENT =
  process.env.IMAGE_IMPORT_USER_AGENT?.trim() ||
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const IMAGE_IMPORT_TIMEOUT_MS = Math.min(
  Math.max(parseInt(process.env.IMAGE_IMPORT_TIMEOUT_MS || '45000', 10) || 45000, 3000),
  120000
);

function assertFetchableImageUrl(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) throw new Error('URL is required');
  let u;
  try {
    u = new URL(trimmed);
  } catch {
    throw new Error('Invalid URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Only http and https URLs are allowed');
  }
  const host = u.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '0.0.0.0' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === '[::1]'
  ) {
    throw new Error('That URL is not allowed');
  }
  return u.toString();
}

function sniffImageMime(buf) {
  if (!buf || buf.length < 12) return null;
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

function normalizeNullableUrlField(v) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

router.post('/import/image-from-url', async (req, res) => {
  try {
    const href = assertFetchableImageUrl(req.body?.url);
    const response = await axios.get(href, {
      responseType: 'arraybuffer',
      timeout: IMAGE_IMPORT_TIMEOUT_MS,
      maxContentLength: MAX_FETCH_IMAGE_BYTES,
      maxBodyLength: MAX_FETCH_IMAGE_BYTES,
      validateStatus: (s) => s >= 200 && s < 300,
      httpAgent: imageImportHttpAgent,
      httpsAgent: imageImportHttpsAgent,
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'User-Agent': IMAGE_IMPORT_USER_AGENT,
        'Accept-Language': 'en-US,en;q=0.9',
      },
      maxRedirects: 5,
      decompress: true,
    });
    const buf = Buffer.from(response.data);
    if (buf.length === 0) {
      return res.status(400).json({ success: false, error: 'Empty response from URL' });
    }
    if (buf.length > MAX_FETCH_IMAGE_BYTES) {
      return res.status(400).json({ success: false, error: 'Image is too large' });
    }
    const headerCt = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const sniffed = sniffImageMime(buf);
    const contentType = headerCt && headerCt.startsWith('image/') ? headerCt : sniffed || null;
    if (!contentType || !contentType.startsWith('image/')) {
      return res.status(400).json({
        success: false,
        error: 'URL did not return a recognizable image (jpeg, png, gif, or webp)',
      });
    }
    const ext =
      contentType === 'image/png'
        ? 'png'
        : contentType === 'image/gif'
          ? 'gif'
          : contentType === 'image/webp'
            ? 'webp'
            : 'jpg';
    const base64 = buf.toString('base64');
    return res.json({
      success: true,
      data: {
        base64,
        contentType,
        suggestedFileName: `from-url-${Date.now()}.${ext}`,
      },
    });
  } catch (err) {
    const status = err.response?.status;
    if (status === 404) {
      return res.status(400).json({ success: false, error: 'Image not found (404)' });
    }
    const msg =
      err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN'
        ? 'Could not resolve host'
        : err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED'
          ? 'Request timed out'
          : err.message || 'Failed to download image';
    return res.status(400).json({ success: false, error: msg });
  }
});

router.post('/upload-microservice', uploadMemory.single('image'), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ success: false, error: 'image file is required' });
    }
    const form = new FormData();
    form.append('image', req.file.buffer, {
      filename: req.file.originalname || 'upload.jpg',
      contentType: req.file.mimetype || 'image/jpeg',
    });
    const fieldNames = [
      'id',
      'type',
      'mainImageMaxWidth',
      'mainImageMaxHeight',
      'thumbMaxWidth',
      'thumbMaxHeight',
      'skipTrim',
    ];
    let forwardedSkipTrim = false;
    for (const name of fieldNames) {
      const v = req.body[name];
      if (v != null && String(v).length) {
        form.append(name, String(v));
        if (name === 'skipTrim') forwardedSkipTrim = true;
      }
    }
    if (!forwardedSkipTrim) form.append('skipTrim', 'true');
    const target = `${uploadMicroserviceBase}/upload`;
    const response = await axios.post(target, form, {
      headers: form.getHeaders(),
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      validateStatus: () => true,
      timeout: 120000,
    });
    if (typeof response.data === 'object' && response.data !== null) {
      return res.status(response.status).json(response.data);
    }
    return res.status(response.status).send(response.data);
  } catch (err) {
    const status = err.response?.status || 502;
    const payload = err.response?.data;
    if (payload && typeof payload === 'object') {
      return res.status(status).json(payload);
    }
    return res.status(502).json({
      success: false,
      error: publicApiErrorMessage(err, 'Upload proxy failed'),
    });
  }
});

router.patch('/products/:productId/images', async (req, res) => {
  try {
    const productId = parseInt(req.params.productId, 10);
    if (Number.isNaN(productId)) {
      return res.status(400).json({ success: false, error: 'Invalid product id' });
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const image = normalizeNullableUrlField(body.image);
    const thumbFromBody = body.thumb_image !== undefined ? body.thumb_image : body.thumb;
    const thumb_image = normalizeNullableUrlField(thumbFromBody);
    if (image === undefined && thumb_image === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Provide at least one of: image, thumb_image, thumb',
      });
    }
    const sets = [];
    const replacements = { productId };
    if (image !== undefined) {
      sets.push('`image` = :image');
      replacements.image = image;
    }
    if (thumb_image !== undefined) {
      sets.push('`thumb_image` = :thumb_image');
      replacements.thumb_image = thumb_image;
    }
    const [meta] = await sequelize.query(
      `UPDATE products SET ${sets.join(', ')} WHERE product_id = :productId`,
      { replacements }
    );
    const affected = meta && typeof meta.affectedRows === 'number' ? meta.affectedRows : 0;
    if (affected === 0) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }
    const [row] = await sequelize.query(
      `SELECT product_id, image, thumb_image, image_updated_at FROM products WHERE product_id = :productId`,
      { type: QueryTypes.SELECT, replacements: { productId } }
    );
    return res.json({
      success: true,
      data: {
        product_id: row.product_id,
        image: row.image ?? null,
        thumb_image: row.thumb_image ?? null,
        image_updated_at: row.image_updated_at ?? null,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: publicApiErrorMessage(err) });
  }
});

module.exports = router;
