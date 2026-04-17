/**
 * Gemini (Google AI) — product image extraction + listing-style image generation.
 * Env: GOOGLE_API_KEY (required), GEMINI_VISION_MODEL, GEMINI_IMAGE_MODEL (optional).
 */
const fetch = require('node-fetch');
const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');

const API_KEY = () => process.env.GOOGLE_API_KEY;
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Vision + JSON extraction; gemini-2.0-flash is deprecated for new API keys — use 2.5+ */
const VISION_MODEL = process.env.GEMINI_VISION_MODEL || 'gemini-2.5-flash';
/** Image generation / editing; override if Google renames models (see ai.google.dev). */
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
/** Retries when Google returns 429 / quota with "retry in Ns" (default 3). Set 1 to disable extra attempts. */
const QUOTA_RETRIES = Math.min(6, Math.max(1, parseInt(process.env.GEMINI_QUOTA_RETRIES || '3', 10)));
const REQUEST_TIMEOUT_MS = Math.min(
  180000,
  Math.max(4000, parseInt(process.env.GEMINI_REQUEST_TIMEOUT_MS || '45000', 10))
);
const GEMINI_MAX_ATTEMPTS = Math.min(
  8,
  Math.max(1, parseInt(process.env.GEMINI_MAX_ATTEMPTS || String(QUOTA_RETRIES + 1), 10))
);
const TAXONOMY_CACHE_TTL_MS = Math.min(
  600000,
  Math.max(5000, parseInt(process.env.GEMINI_TAXONOMY_CACHE_TTL_MS || '120000', 10))
);

const LISTING_IMAGE_PROMPT = `Using the attached product photo, produce a single square e-commerce product image suitable for an online store listing.

Requirements:
- Output must be suitable for a 512×512 pixel square frame (1:1 aspect ratio).
- Pure white background (#FFFFFF) with soft, natural, even studio lighting; no harsh shadows and no visible reflections on the background.
- **Composition — enforce consistent product size across items:** center the product and keep the longest visible product dimension at roughly **80% of the frame** (acceptable range: 78% to 82%). Do NOT make the product tiny and do NOT zoom so much that edges are cropped.
- Keep approximate white margins near: left/right 10% each, top/bottom 10% each (small variation is okay as long as product size stays consistent).
- If the first composition would result in a small product, zoom in before finalizing. If it would clip the product, zoom out slightly.
- Retouch and clean the product surface: remove dust specks, dirt marks, wrinkles, creases, dents, scratches, smudges, and unwanted glare/reflections from plastic wrap or packaging.
- Remove temporary labels/stickers/barcode price tags only when they are clearly non-brand temporary artifacts.
- Keep the product geometry realistic while cleaning: no melted edges, no warped shape, no fake text, and no artificial over-smoothing.
- Keep the product straight, sharp, and fully readable; do not crop important label text.
- Preserve the original packaging design, colors, typography, and text as accurately as possible — do not redesign the brand or invent text.
- Style: minimal, professional, catalog photography.

Return only the edited/generated product image as image output.`;

function normalizeLabel(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function loadBrandRows() {
  const rows = await sequelize.query(
    `SELECT id, name FROM brand WHERE (is_deleted = 0 OR is_deleted IS NULL) ORDER BY name ASC LIMIT 500`,
    { type: QueryTypes.SELECT }
  );
  return rows;
}

async function loadCategoryRows() {
  const rows = await sequelize.query(
    `SELECT category_id, category_name, slug FROM categories WHERE (is_deleted = 0 OR is_deleted IS NULL) ORDER BY category_name ASC LIMIT 500`,
    { type: QueryTypes.SELECT }
  );
  return rows;
}

async function loadTagRows() {
  const rows = await sequelize.query(
    `SELECT id, name FROM tags ORDER BY name ASC LIMIT 500`,
    { type: QueryTypes.SELECT }
  );
  return rows;
}

const taxonomyCache = {
  loadedAt: 0,
  brands: null,
  categories: null,
  tags: null,
};

async function loadTaxonomyRowsCached() {
  const now = Date.now();
  const fresh = now - taxonomyCache.loadedAt < TAXONOMY_CACHE_TTL_MS;
  if (fresh && taxonomyCache.brands && taxonomyCache.categories && taxonomyCache.tags) {
    return {
      brands: taxonomyCache.brands,
      categories: taxonomyCache.categories,
      tags: taxonomyCache.tags,
    };
  }
  const [brands, categories, tags] = await Promise.all([
    loadBrandRows(),
    loadCategoryRows(),
    loadTagRows(),
  ]);
  taxonomyCache.loadedAt = now;
  taxonomyCache.brands = brands;
  taxonomyCache.categories = categories;
  taxonomyCache.tags = tags;
  return { brands, categories, tags };
}

function matchRowByName(name, rows, nameKey = 'name') {
  const n = normalizeLabel(name);
  if (!n) return null;
  const exact = rows.find((r) => normalizeLabel(r[nameKey]) === n);
  if (exact) return exact;
  const partial = rows.find((r) => {
    const rn = normalizeLabel(r[nameKey]);
    if (!rn) return false;
    if (rn.includes(n) || n.includes(rn)) return true;
    return false;
  });
  return partial || null;
}

function parseJsonFromModelText(text) {
  let t = String(text || '').trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

function normalizeExtractedUnit(rawValue) {
  let value = String(rawValue || '').trim();
  if (!value) return '';
  value = value.replace(/\s+/g, ' ');

  const pieceMatch = value.match(/(\d+)\s*(?:x\s*)?(?:items?|pcs?|pieces?)\b(?:\s*(?:box|pack))?/i);
  if (pieceMatch) {
    const qty = Number(pieceMatch[1]);
    return qty === 1 ? '1Pc' : `${pieceMatch[1]}Pcs`;
  }

  value = value
    .replace(/\b(gm|gms|gram|grams)\b/gi, 'g')
    .replace(/\b(kg|kgs|kilogram|kilograms)\b/gi, 'kg')
    .replace(/\b(mg|mgs|milligram|milligrams)\b/gi, 'mg')
    .replace(/\b(ml|mls|milliliter|milliliters|millilitre|millilitres)\b/gi, 'ml')
    .replace(/\b(l|lt|lts|liter|liters|litre|litres)\b/gi, 'l');

  value = value.replace(/(\d+(?:\.\d+)?)\s*(kg|g|mg|ml|l)\b/gi, (_, n, u) => `${n}${String(u).toLowerCase()}`);
  value = value.replace(/\s*[xX]\s*/g, 'x').replace(/\s+/g, ' ').trim();
  return value;
}

function extractUnitFromName(productName) {
  const text = String(productName || '').trim();
  if (!text) return '';

  const pieceMatch = text.match(/(\d+)\s*(?:x\s*)?(?:items?|pcs?|pieces?)\b(?:\s*(?:box|pack))?/i);
  if (pieceMatch) {
    const qty = Number(pieceMatch[1]);
    return qty === 1 ? '1Pc' : `${pieceMatch[1]}Pcs`;
  }

  const multiPackMatch = text.match(
    /(\d+)\s*[xX]\s*(\d+(?:\.\d+)?)\s*(kg|g|gm|grams?|mg|ml|l|lt|lit(?:er|re)s?)/i
  );
  if (multiPackMatch) {
    return normalizeExtractedUnit(`${multiPackMatch[1]}x${multiPackMatch[2]}${multiPackMatch[3]}`);
  }

  const simpleMatch = text.match(/(\d+(?:\.\d+)?)\s*(kg|g|gm|grams?|mg|ml|l|lt|lit(?:er|re)s?)/i);
  if (simpleMatch) {
    return normalizeExtractedUnit(`${simpleMatch[1]}${simpleMatch[2]}`);
  }
  return '';
}

function escapeRegex(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeProductNameCase(rawName) {
  const lower = String(rawName || '').trim().toLowerCase();
  if (!lower) return '';
  return lower
    .split(/\s+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : ''))
    .join(' ');
}

function removeUnitFromName(productName, unit) {
  let name = String(productName || '').replace(/\s+/g, ' ').trim();
  const normalizedUnit = String(unit || '').trim();
  if (!name) return '';
  if (!normalizedUnit) return name;

  const looseUnitPattern = escapeRegex(normalizedUnit)
    .replace(/\\\s+/g, '\\s+')
    .replace(/x/gi, '\\s*[xX]\\s*');
  const direct = new RegExp(`(?:^|\\s|\\(|\\[|-)${looseUnitPattern}(?:\\s|\\)|\\]|$|,)`, 'ig');
  name = name.replace(direct, ' ');

  // Also strip common "100 g / 1 kg / 500 ml" variants if unit appears that way in the name.
  const compact = normalizedUnit.match(/^(\d+(?:\.\d+)?)(kg|g|mg|ml|l)$/i);
  if (compact) {
    const [, n, u] = compact;
    const qtyLoose = new RegExp(`(?:^|\\s|\\(|\\[|-)${escapeRegex(n)}\\s*${escapeRegex(u)}(?:\\s|\\)|\\]|$|,)`, 'ig');
    name = name.replace(qtyLoose, ' ');
  }

  // Strip piece-count variants like "3 piece", "3 pcs", "3 items", "3 piece pack".
  const pcs = normalizedUnit.match(/^(\d+)pcs?$/i);
  if (pcs) {
    const qty = pcs[1];
    const pcsLoose = new RegExp(
      `(?:^|\\s|\\(|\\[|-)${escapeRegex(qty)}\\s*(?:pcs?|pieces?|items?)\\b(?:\\s*(?:box|pack))?(?:\\s|\\)|\\]|$|,)`,
      'ig'
    );
    name = name.replace(pcsLoose, ' ');
  }

  return name.replace(/\s+/g, ' ').replace(/^[\s,;:|/-]+|[\s,;:|/-]+$/g, '').trim();
}

function normalizeSuggestedProductName(aiName, unit, existingName) {
  const aiRaw = String(aiName || '').trim();
  const fallbackRaw = String(existingName || '').trim();
  const base = aiRaw || fallbackRaw;
  if (!base) return '';

  let cleaned = removeUnitFromName(base, unit);
  if (!cleaned && fallbackRaw) cleaned = removeUnitFromName(fallbackRaw, unit);
  if (!cleaned) cleaned = base;
  return normalizeProductNameCase(cleaned);
}

function tokenizeNameForCompare(name) {
  return normalizeLabel(name)
    .split(' ')
    .map((x) => x.trim())
    .filter((x) => x.length >= 2);
}

function shouldPreferExistingProductName(aiName, existingName) {
  const ai = String(aiName || '').trim();
  const existing = String(existingName || '').trim();
  if (!existing) return false;
  if (!ai) return true;

  const aiNorm = normalizeLabel(ai);
  const existingNorm = normalizeLabel(existing);
  if (!aiNorm) return true;
  if (aiNorm === existingNorm) return true;

  // Weak OCR-like outputs or placeholders from transparent/no-label packs.
  if (
    /^(product|item|pack|grocery|food|unknown|n\/a)$/i.test(aiNorm) ||
    aiNorm.length <= 4
  ) {
    return true;
  }

  const aiTokens = tokenizeNameForCompare(aiNorm);
  const existingTokens = tokenizeNameForCompare(existingNorm);
  if (aiTokens.length <= 1 && existingTokens.length > 0) return true;

  const existingSet = new Set(existingTokens);
  let overlap = 0;
  for (const t of aiTokens) {
    if (existingSet.has(t)) overlap += 1;
  }
  const overlapRatio = aiTokens.length ? overlap / aiTokens.length : 0;

  // If AI name shares almost nothing with current draft name, trust existing draft more.
  if (overlapRatio < 0.34) return true;
  return false;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseRetrySecondsFromMessage(msg) {
  const m = String(msg).match(/retry in\s+([\d.]+)\s*s/i);
  if (!m) return null;
  const sec = parseFloat(m[1], 10);
  if (!Number.isFinite(sec)) return null;
  return Math.min(120, Math.max(1, Math.ceil(sec)));
}

function isQuotaOrRateLimit(httpStatus, message, json) {
  if (httpStatus === 429) return true;
  const st = json?.error?.status || json?.error?.code;
  if (st === 'RESOURCE_EXHAUSTED' || st === 429) return true;
  const m = String(message || '');
  return /RESOURCE_EXHAUSTED|quota exceeded|rate limit|too many requests/i.test(m);
}

function isRetryableTransportError(err) {
  const code = String(err?.code || '').toUpperCase();
  if (['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'ENETUNREACH', 'ECONNREFUSED'].includes(code)) {
    return true;
  }
  const msg = String(err?.message || '');
  return /network|timed out|timeout|socket hang up|temporarily unavailable/i.test(msg);
}

function isRetryableHttpStatus(httpStatus) {
  return httpStatus === 408 || httpStatus === 425 || httpStatus === 429 || httpStatus >= 500;
}

function quotaHintFooter(message) {
  const m = String(message || '');
  if (!/quota|limit:\s*0|billing|RESOURCE_EXHAUSTED|rate limit/i.test(m)) return '';
  return (
    '\n\n---\n' +
    'Grocery CMS hint: If you see "limit: 0" or repeated quota errors, link a billing account to the Google Cloud project that owns this API key (Console → Billing), then enable the Generative Language API. Free tiers still apply to many models; see https://ai.google.dev/pricing and https://ai.google.dev/gemini-api/docs/rate-limits'
  );
}

async function geminiGenerateContent(model, body) {
  const key = API_KEY();
  if (!key) throw new Error('GOOGLE_API_KEY is not configured');
  const url = `${BASE}/${model}:generateContent?key=${encodeURIComponent(key)}`;

  let lastMsg = '';
  for (let attempt = 0; attempt < GEMINI_MAX_ATTEMPTS; attempt += 1) {
    let res;
    let rawText = '';
    let json = {};
    let timer = null;
    try {
      const controller = new AbortController();
      timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (timer) clearTimeout(timer);
      rawText = await res.text();
    } catch (err) {
      if (timer) clearTimeout(timer);
      const transportRetryable = isRetryableTransportError(err);
      if (attempt < GEMINI_MAX_ATTEMPTS - 1 && transportRetryable) {
        const delayMs = Math.min(30000, 600 * 2 ** attempt + Math.floor(Math.random() * 300));
        await sleep(delayMs);
        continue;
      }
      throw err;
    }

    try {
      json = rawText ? JSON.parse(rawText) : {};
    } catch {
      const err = new Error(`Gemini invalid JSON: ${rawText.slice(0, 200)}`);
      err.code = 'PARSE_FAILED';
      throw err;
    }
    if (res.ok) return json;

    lastMsg = json.error?.message || json.message || rawText.slice(0, 1200);
    const quotaRetryable = isQuotaOrRateLimit(res.status, lastMsg, json);
    const statusRetryable = isRetryableHttpStatus(res.status);
    if ((quotaRetryable || statusRetryable) && attempt < GEMINI_MAX_ATTEMPTS - 1) {
      const waitSec = parseRetrySecondsFromMessage(lastMsg);
      const backoff = Math.min(30000, 1800 * 2 ** attempt);
      const jitter = Math.floor(Math.random() * 400);
      const delayMs = waitSec != null ? waitSec * 1000 + 250 : backoff + jitter;
      await sleep(delayMs);
      continue;
    }
    const err = new Error(lastMsg || `Gemini request failed (HTTP ${res.status})`);
    err.httpStatus = res.status;
    throw err;
  }
  throw new Error((lastMsg || 'Gemini request failed') + quotaHintFooter(lastMsg));
}

function concatTextParts(response) {
  const cands = response.candidates || [];
  if (cands.length === 0) {
    const fb = response.promptFeedback || response.error;
    throw new Error(fb?.blockReason || fb?.message || 'No candidates from Gemini');
  }
  const parts = cands[0].content?.parts || [];
  return parts.map((p) => p.text || '').join('').trim();
}

function sanitizeHintList(input, maxCount) {
  const arr = Array.isArray(input) ? input.map((v) => String(v || '').trim()) : [];
  const deduped = [];
  const seen = new Set();
  for (const item of arr) {
    if (!item) continue;
    const key = normalizeLabel(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(item.slice(0, 120));
    if (deduped.length >= maxCount) break;
  }
  return deduped;
}

function validateAiRawPayload(aiRaw) {
  if (!aiRaw || typeof aiRaw !== 'object') {
    const err = new Error('Model output is not a JSON object');
    err.code = 'PARSE_FAILED';
    throw err;
  }
  return {
    product_name: String(aiRaw.product_name || '').trim(),
    image_text_product_name: String(aiRaw.image_text_product_name || '').trim(),
    suggested_product_name: String(aiRaw.suggested_product_name || '').trim(),
    unit: String(aiRaw.unit || '').trim(),
    brand_text: String(aiRaw.brand_text || '').trim(),
    category_hints: sanitizeHintList(aiRaw.category_hints, 5),
    tag_hints: sanitizeHintList(aiRaw.tag_hints, 10),
    notes: String(aiRaw.notes || '').trim().slice(0, 300),
  };
}

function dedupeNameOptions(options) {
  const out = [];
  const seen = new Set();
  for (const raw of options || []) {
    const value = String(raw || '').trim();
    if (!value) continue;
    const key = normalizeLabel(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function extractFirstInlineImage(response) {
  const cands = response.candidates || [];
  for (const c of cands) {
    const parts = c.content?.parts || [];
    for (const p of parts) {
      const inline = p.inlineData || p.inline_data;
      if (inline?.data) {
        return {
          base64: inline.data,
          mimeType: inline.mimeType || inline.mime_type || 'image/png',
        };
      }
    }
  }
  throw new Error('No image data in Gemini response (try GEMINI_IMAGE_MODEL or another model)');
}

/**
 * Vision extraction from product photo buffer.
 * @param {Buffer} imageBuffer
 * @param {string} mimeType
 */
async function extractProductFromImage(imageBuffer, mimeType, options = {}) {
  const existingProductName = String(options?.existingProductName || '').trim();
  const { brands, categories, tags } = await loadTaxonomyRowsCached();

  const brandLines = brands.map((b) => `- ${b.name}`).join('\n');
  const catLines = categories.map((c) => `- ${c.category_name}`).join('\n');
  const tagLines = tags.map((t) => `- ${t.name}`).join('\n');

  const instruction = `You analyze grocery / retail product packaging photos for an e-commerce CMS.

Return ONLY valid JSON (no markdown fences) with this exact structure:
{
  "image_text_product_name": "string — product name read from packaging text exactly/as-close-as-possible (may include OCR noise)",
  "suggested_product_name": "string — cleaned catalog-ready name with corrected spelling/wording based on what is visible (better than raw OCR text)",
  "product_name": "string — same as suggested_product_name for backward compatibility",
  "unit": "string — quantity + unit only, e.g. 500 ml, 1 kg, 6 x 330 ml, 1Pc, 3Pcs; empty string if unclear",
  "brand_text": "string — brand name read from packaging, or empty if unknown",
  "category_hints": ["0 to 5 short category names that fit this product"],
  "tag_hints": ["0 to 10 short search tags"],
  "notes": "optional — visible claims or bilingual text worth knowing; may be empty string"
}

Rules:
- Prefer spelling that matches one of the lists below when the product clearly matches.
- If OCR text has obvious typo/noise (example: "Pich"), fix it in suggested_product_name (example: "Pick").
- For count-based non-weight/non-volume packs (piece/item/pcs), output unit as 1Pc when quantity is 1, otherwise NPcs (example: 3Pcs).
- If unit already captures the count, do not repeat it in suggested_product_name (prefer "Glass Pack", not "Glass Pack 3 Piece").
- Do not invent a brand; only use brand_text visible on the pack or leave empty.
- category_hints and tag_hints should use names from the lists when appropriate; you may suggest new short labels only when nothing fits.

Existing brands (prefer exact or closest match):
${brandLines || '(none)'}

Existing categories:
${catLines || '(none)'}

Existing tags:
${tagLines || '(none)'}

Current draft product name from CMS (use this when image text is unclear, but normalize it):
${existingProductName || '(empty)'}`;

  const b64 = imageBuffer.toString('base64');
  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { inline_data: { mime_type: mimeType || 'image/jpeg', data: b64 } },
          { text: instruction },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 2048,
    },
  };

  const response = await geminiGenerateContent(VISION_MODEL, body);
  const text = concatTextParts(response);
  const aiRaw = validateAiRawPayload(parseJsonFromModelText(text));

  const aiImageTextName = aiRaw.image_text_product_name || aiRaw.product_name;
  const aiSuggestedName = aiRaw.suggested_product_name || aiRaw.product_name || aiImageTextName;
  const aiProductName = aiSuggestedName;
  let unit = normalizeExtractedUnit(aiRaw.unit);
  if (!unit) {
    unit =
      extractUnitFromName(aiSuggestedName) ||
      extractUnitFromName(aiImageTextName) ||
      extractUnitFromName(existingProductName);
  }
  const chosenName = shouldPreferExistingProductName(aiProductName, existingProductName)
    ? existingProductName
    : aiProductName;
  const product_name = normalizeSuggestedProductName(chosenName, unit, existingProductName);
  const normalizedSuggestedName = normalizeSuggestedProductName(
    aiSuggestedName,
    unit,
    existingProductName
  );
  const normalizedImageTextName = normalizeSuggestedProductName(
    aiImageTextName,
    unit,
    existingProductName
  );
  const name_options = dedupeNameOptions([
    product_name,
    normalizedSuggestedName,
    normalizedImageTextName,
    existingProductName,
  ]);
  const brand_text = aiRaw.brand_text;
  const category_hints = aiRaw.category_hints;
  const tag_hints = aiRaw.tag_hints;

  const brandRow = brand_text ? matchRowByName(brand_text, brands, 'name') : null;
  const proposedBrand = brand_text
    ? brandRow
      ? { mode: 'matched', id: brandRow.id, name: brandRow.name }
      : { mode: 'new', id: null, name: brand_text }
    : { mode: 'none', id: null, name: '' };

  const proposedCategories = [];
  for (const hint of category_hints) {
    const h = String(hint || '').trim();
    if (!h) continue;
    const row = matchRowByName(h, categories, 'category_name');
    if (row) {
      proposedCategories.push({
        mode: 'matched',
        id: row.category_id,
        name: row.category_name,
      });
    } else {
      proposedCategories.push({ mode: 'new', id: null, name: h });
    }
  }

  const proposedTags = [];
  for (const hint of tag_hints) {
    const h = String(hint || '').trim();
    if (!h) continue;
    const row = matchRowByName(h, tags, 'name');
    if (row) {
      proposedTags.push({ mode: 'matched', id: row.id, name: row.name });
    } else {
      proposedTags.push({ mode: 'new', id: null, name: h });
    }
  }

  return {
    aiRaw,
    proposed: {
      product_name,
      name_options,
      unit,
      brand: proposedBrand,
      categories: proposedCategories,
      tags: proposedTags,
    },
  };
}

/**
 * Generate / edit listing image (white background, 512-friendly).
 */
async function generateListingImage(imageBuffer, mimeType) {
  const b64 = imageBuffer.toString('base64');
  const baseBody = {
    contents: [
      {
        role: 'user',
        parts: [
          { inline_data: { mime_type: mimeType || 'image/jpeg', data: b64 } },
          { text: LISTING_IMAGE_PROMPT },
        ],
      },
    ],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      temperature: 0.25,
      imageConfig: {
        aspectRatio: '1:1',
      },
    },
  };

  try {
    const response = await geminiGenerateContent(IMAGE_MODEL, baseBody);
    return extractFirstInlineImage(response);
  } catch (e) {
    const msg = e.message || '';
    if (/imageConfig|image_config|responseModalities|Unknown name/i.test(msg)) {
      const fallback = {
        ...baseBody,
        generationConfig: {
          responseModalities: ['IMAGE'],
          temperature: 0.25,
        },
      };
      const response = await geminiGenerateContent(IMAGE_MODEL, fallback);
      return extractFirstInlineImage(response);
    }
    throw e;
  }
}

module.exports = {
  extractProductFromImage,
  generateListingImage,
};
