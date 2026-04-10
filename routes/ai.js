/**
 * AI routes - fix product names, clean names with AI
 */
const express = require('express');
const fetch = require('node-fetch');
const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');

const router = express.Router();
const API_KEY = process.env.GOOGLE_API_KEY;
const BASE_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
/** Default text model; override with GEMINI_TEXT_MODEL. Avoid gemini-2.0-flash for new API keys. */
const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash';

async function generateContent(model, prompt) {
  if (!API_KEY) throw new Error('Missing GOOGLE_API_KEY');
  const endpoint = `${BASE_ENDPOINT}/${model}:generateContent?key=${API_KEY}`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  if (!res.ok) throw new Error(`API error: ${await res.text()}`);
  const body = await res.json();
  const candidates = body.candidates || [];
  if (candidates.length === 0) throw new Error('No candidates returned');
  const candidate = candidates[0];
  let text = candidate.output || (candidate.content?.parts?.map((p) => p.text).join('') || '');
  return text.trim();
}

async function fixProductName(inputName) {
  const prompt = `Fix the product name for a website in proper English and format. Return only the corrected product name with no explanation. Example input: "${inputName}"`;
  return generateContent(TEXT_MODEL, prompt);
}

router.post('/fix-product-name', async (req, res) => {
  try {
    const { productName } = req.body;
    if (!productName) return res.status(400).json({ error: 'Missing productName' });
    const fixedName = await fixProductName(productName);
    res.json({ fixedName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/clean-names', async (req, res) => {
  try {
    if (!API_KEY) return res.status(503).json({ success: false, message: 'GOOGLE_API_KEY not configured' });

    let { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      const rows = await sequelize.query(
        `SELECT product_id FROM products WHERE is_verified = 1 AND brand_id IS NULL AND (slug IS NULL OR slug = '') LIMIT 10`,
        { type: QueryTypes.SELECT }
      );
      if (rows.length === 0) return res.status(404).json({ success: false, message: 'No products found to clean' });
      ids = rows.map((r) => r.product_id);
    }

    const normalize = (str) => str?.toLowerCase().replace(/['".,]/g, '').replace(/\s+/g, ' ').trim();
    const updates = [];
    const [brands] = await sequelize.query('SELECT id, name FROM brand', { type: QueryTypes.SELECT });
    const brandMap = {};
    brands.forEach((b) => { brandMap[normalize(b.name)] = b.id; });

    const [categories] = await sequelize.query('SELECT category_id, category_name FROM categories', { type: QueryTypes.SELECT });
    const categoryMap = {};
    categories.forEach((c) => { categoryMap[normalize(c.category_name)] = c.category_id; });
    const categoryList = Object.keys(categoryMap).join(', ');

    for (const id of ids) {
      const [products] = await sequelize.query('SELECT product_name, slug FROM products WHERE product_id = ?', {
        type: QueryTypes.SELECT,
        replacements: [id],
      });
      const product = products[0];
      if (!product) continue;

      const prompt = `From this product name: "${product.product_name}", extract:
1. Clean product name (remove units like 900gm, 1kg)
2. Unit in lowercase (e.g. "320 gm")
3. Brand name if obvious
4. URL-safe slug, lowercase hyphenated
5. Categories from this list only: [${categoryList}]

Return JSON: {"name":"...","unit":"...","brand":"...","slug":"...","categories":["..."]}
Only valid JSON, no extra text.`;

      try {
        const aiResponse = await generateContent(TEXT_MODEL, prompt);
        const parsed = JSON.parse(aiResponse.replace(/```json|```/g, '').trim());
        const cleanedName = parsed.name?.trim() || product.product_name;
        const extractedUnit = parsed.unit?.trim();
        const brandName = parsed.brand?.trim();
        const productSlug = parsed.slug?.trim();
        const categorySuggestions = Array.isArray(parsed.categories) ? parsed.categories : [];

        let brandId = brandName ? brandMap[normalize(brandName)] : null;
        if (brandName && !brandId) {
          const [ins] = await sequelize.query('INSERT INTO brand (name, slug, is_active, created_at, updated_at) VALUES (?, ?, 1, NOW(), NOW())', {
            replacements: [brandName, (brandName || '').replace(/\s+/g, '-').toLowerCase()],
          });
          const [r] = await sequelize.query('SELECT LAST_INSERT_ID() as id', { type: QueryTypes.SELECT });
          brandId = r[0]?.id;
          if (brandId) brandMap[normalize(brandName)] = brandId;
        }

        const slugToUse = !product.slug && productSlug ? productSlug : product.slug;
        await sequelize.query(
          'UPDATE products SET product_name = ?, unit = ?, brand_id = ?, slug = ?, updated_at = NOW() WHERE product_id = ?',
          { replacements: [cleanedName, extractedUnit, brandId, slugToUse, id] }
        );

        for (const catName of categorySuggestions) {
          const cid = categoryMap[normalize(catName)];
          if (cid) {
            await sequelize.query(
              'INSERT IGNORE INTO product_categories (product_id, category_id, created_at, updated_at) VALUES (?, ?, NOW(), NOW())',
              { replacements: [id, cid] }
            );
          }
        }

        updates.push({
          product_id: id,
          original_name: product.product_name,
          updated_name: cleanedName,
          unit: extractedUnit,
          brand: brandName,
          slug: slugToUse,
          categories: categorySuggestions,
        });
      } catch (err) {
        console.warn(`AI clean failed for product ${id}:`, err.message);
      }
    }

    res.json({ success: true, message: 'Products updated successfully', updated: updates });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
