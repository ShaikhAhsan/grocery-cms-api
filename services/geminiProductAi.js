/**
 * Gemini (Google AI) — product image extraction + listing-style image generation.
 * Env: GOOGLE_API_KEY (required), GEMINI_VISION_MODEL, GEMINI_IMAGE_MODEL (optional).
 */
const fetch = require('node-fetch');
const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');

const API_KEY = () => process.env.GOOGLE_API_KEY;
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const VISION_MODEL = process.env.GEMINI_VISION_MODEL || 'gemini-2.0-flash';
/** Image generation / editing; override if Google renames models (see ai.google.dev). */
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';

const LISTING_IMAGE_PROMPT = `Using the attached product photo, produce a single square e-commerce product image suitable for an online store listing.

Requirements:
- Output must be suitable for a 512×512 pixel square frame (1:1 aspect ratio).
- Place the product centered on a pure white background (#FFFFFF).
- Use soft, natural, even studio lighting with no harsh shadows and no visible reflections on the background.
- Leave even spacing around the product; slightly more margin at the top, left, and right than at the bottom for a clean layout.
- Keep the product straight, fully visible, and sharp; do not crop important label text.
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

function slugifyCategoryName(name) {
  const s = normalizeLabel(name).replace(/\s+/g, '-');
  return s || 'category';
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

async function geminiGenerateContent(model, body) {
  const key = API_KEY();
  if (!key) throw new Error('GOOGLE_API_KEY is not configured');
  const url = `${BASE}/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const rawText = await res.text();
  let json = {};
  try {
    json = rawText ? JSON.parse(rawText) : {};
  } catch {
    throw new Error(`Gemini invalid JSON: ${rawText.slice(0, 200)}`);
  }
  if (!res.ok) {
    const msg = json.error?.message || json.message || rawText.slice(0, 400);
    throw new Error(msg || `Gemini HTTP ${res.status}`);
  }
  return json;
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
async function extractProductFromImage(imageBuffer, mimeType) {
  const brands = await loadBrandRows();
  const categories = await loadCategoryRows();
  const tags = await loadTagRows();

  const brandLines = brands.map((b) => `- ${b.name}`).join('\n');
  const catLines = categories.map((c) => `- ${c.category_name}`).join('\n');
  const tagLines = tags.map((t) => `- ${t.name}`).join('\n');

  const instruction = `You analyze grocery / retail product packaging photos for an e-commerce CMS.

Return ONLY valid JSON (no markdown fences) with this exact structure:
{
  "product_name": "string — full product title as it should appear in the catalog; include variant (flavor, size, multipack) as part of the name when visible",
  "unit": "string — quantity + unit only, e.g. 500 ml, 1 kg, 6 x 330 ml; empty string if unclear",
  "brand_text": "string — brand name read from packaging, or empty if unknown",
  "category_hints": ["0 to 5 short category names that fit this product"],
  "tag_hints": ["0 to 10 short search tags"],
  "notes": "optional — visible claims or bilingual text worth knowing; may be empty string"
}

Rules:
- Prefer spelling that matches one of the lists below when the product clearly matches.
- Do not invent a brand; only use brand_text visible on the pack or leave empty.
- category_hints and tag_hints should use names from the lists when appropriate; you may suggest new short labels only when nothing fits.

Existing brands (prefer exact or closest match):
${brandLines || '(none)'}

Existing categories:
${catLines || '(none)'}

Existing tags:
${tagLines || '(none)'}`;

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
  const aiRaw = parseJsonFromModelText(text);

  const product_name = String(aiRaw.product_name || '').trim();
  const unit = String(aiRaw.unit || '').trim();
  const brand_text = String(aiRaw.brand_text || '').trim();
  const category_hints = Array.isArray(aiRaw.category_hints) ? aiRaw.category_hints.map(String) : [];
  const tag_hints = Array.isArray(aiRaw.tag_hints) ? aiRaw.tag_hints.map(String) : [];

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
      temperature: 0.4,
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
          temperature: 0.4,
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
