const express = require('express');
const http = require('http');
const https = require('https');
const axios = require('axios');
const geminiProductAi = require('../../services/geminiProductAi');
const { publicApiErrorMessage } = require('../../utils/publicApiErrorMessage');

const router = express.Router();

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
const BULK_AI_MAX_ITEMS = Math.min(50, Math.max(1, parseInt(process.env.CMS_BULK_AI_MAX_ITEMS || '20', 10)));
const BULK_AI_CONCURRENCY = Math.min(8, Math.max(1, parseInt(process.env.CMS_BULK_AI_CONCURRENCY || '4', 10)));

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

function normalizeAiError(err) {
  if (!err) return { code: 'UNKNOWN', message: 'Unknown error' };
  const status = err.status || err.httpStatus;
  if (status === 429) return { code: 'RATE_LIMITED', message: err.message || 'Rate limited' };
  if (status === 503) return { code: 'MODEL_UNAVAILABLE', message: err.message || 'Model unavailable' };
  if (status === 504) return { code: 'MODEL_TIMEOUT', message: err.message || 'Model timed out' };
  const msg = String(err.message || '');
  if (/timed out|timeout/i.test(msg)) return { code: 'MODEL_TIMEOUT', message: msg };
  if (/parse|json/i.test(msg)) return { code: 'PARSE_FAILED', message: msg };
  if (/URL did not return an image|Invalid URL|URL is required|not allowed/i.test(msg)) {
    return { code: 'FETCH_IMAGE_FAILED', message: msg };
  }
  return { code: err.code || 'AI_EXTRACT_FAILED', message: msg || 'AI extract failed' };
}

async function resolveImageInput(body) {
  let buf;
  let mime = (body && body.mimeType) || 'image/jpeg';
  if (body?.imageBase64) {
    buf = Buffer.from(String(body.imageBase64), 'base64');
    if (!buf.length) {
      const err = new Error('imageBase64 is empty');
      err.status = 400;
      throw err;
    }
    const sniffed = sniffImageMime(buf);
    if (sniffed) mime = sniffed;
  } else if (body?.imageUrl) {
    const href = assertFetchableImageUrl(body.imageUrl);
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
      },
      maxRedirects: 5,
      decompress: true,
    });
    buf = Buffer.from(response.data);
    const headerCt = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const sniffed = sniffImageMime(buf);
    mime = headerCt && headerCt.startsWith('image/') ? headerCt : sniffed || 'image/jpeg';
    if (!mime.startsWith('image/')) {
      const err = new Error('URL did not return an image');
      err.status = 400;
      throw err;
    }
  } else {
    const err = new Error('Provide imageUrl or imageBase64');
    err.status = 400;
    throw err;
  }
  if (buf.length > MAX_FETCH_IMAGE_BYTES) {
    const err = new Error('Image is too large');
    err.status = 400;
    throw err;
  }
  return { buf, mime };
}

async function runPool(items, worker, concurrency) {
  const output = new Array(items.length);
  let cursor = 0;
  const threads = new Array(Math.min(concurrency, items.length)).fill(0).map(async () => {
    while (cursor < items.length) {
      const idx = cursor;
      cursor += 1;
      output[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(threads);
  return output;
}

router.post('/ai/product/extract-from-image', async (req, res) => {
  try {
    if (!process.env.GOOGLE_API_KEY) {
      return res.status(503).json({
        success: false,
        error: 'GOOGLE_API_KEY is not set. Add it to grocery-cms-api .env (Google AI Studio key).',
      });
    }
    const { buf, mime } = await resolveImageInput(req.body);
    const existingProductName = req.body?.product_name ?? req.body?.productName;
    const data = await geminiProductAi.extractProductFromImage(buf, mime, {
      existingProductName,
    });
    return res.json({ success: true, data });
  } catch (err) {
    const normalized = normalizeAiError(err);
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    return res.status(status).json({
      success: false,
      error: normalized.message,
      code: normalized.code,
    });
  }
});

router.post('/ai/product/extract-from-image-bulk', async (req, res) => {
  try {
    if (!process.env.GOOGLE_API_KEY) {
      return res.status(503).json({
        success: false,
        error: 'GOOGLE_API_KEY is not set. Add it to grocery-cms-api .env (Google AI Studio key).',
      });
    }
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) {
      return res.status(400).json({ success: false, error: 'items[] is required' });
    }
    if (items.length > BULK_AI_MAX_ITEMS) {
      return res.status(400).json({
        success: false,
        error: `Too many items (max ${BULK_AI_MAX_ITEMS})`,
      });
    }
    const results = await runPool(
      items,
      async (item, index) => {
        const product_id = item?.product_id != null ? Number(item.product_id) : null;
        try {
          const { buf, mime } = await resolveImageInput(item);
          const data = await geminiProductAi.extractProductFromImage(buf, mime, {
            existingProductName: item?.product_name ?? item?.productName,
          });
          return {
            index,
            product_id,
            status: 'ok',
            data,
          };
        } catch (err) {
          const normalized = normalizeAiError(err);
          return {
            index,
            product_id,
            status: 'error',
            error: normalized.message,
            code: normalized.code,
          };
        }
      },
      BULK_AI_CONCURRENCY
    );
    return res.json({
      success: true,
      data: {
        total: results.length,
        successCount: results.filter((r) => r.status === 'ok').length,
        failedCount: results.filter((r) => r.status !== 'ok').length,
        items: results,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: publicApiErrorMessage(err, 'Bulk AI extract failed') });
  }
});

router.post('/ai/product/generate-listing-image', async (req, res) => {
  try {
    if (!process.env.GOOGLE_API_KEY) {
      return res.status(503).json({
        success: false,
        error: 'GOOGLE_API_KEY is not set.',
      });
    }
    const { buf, mime } = await resolveImageInput(req.body);
    const out = await geminiProductAi.generateListingImage(buf, mime);
    return res.json({
      success: true,
      data: {
        imageBase64: out.base64,
        mimeType: out.mimeType,
      },
    });
  } catch (err) {
    const normalized = normalizeAiError(err);
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    return res.status(status).json({
      success: false,
      error: normalized.message,
      code: normalized.code,
    });
  }
});

module.exports = router;
