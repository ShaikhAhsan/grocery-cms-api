/**
 * Fairo site - fetch missing product images from fairo.pk
 */
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const { sequelize } = require('../../config/database');
const { QueryTypes } = require('sequelize');
const { successResponse, errorResponse } = require('../../utils/responseHandler');

const router = express.Router();

async function fetchProductByBarcode(barcode) {
  try {
    const response = await axios.get('https://fairo.pk/wp-admin/admin-ajax.php', {
      params: { action: 'woodmart_ajax_search', post_type: 'product', query: barcode },
      headers: { Cookie: 'PHPSESSID=default' },
      timeout: 30000,
    });
    const suggestions = response.data?.suggestions || [];
    if (suggestions.length === 0) return null;

    const item = suggestions[0];
    const $ = cheerio.load(item.thumbnail || '');
    const srcset = $('img').attr('srcset');
    let imageUrl = $('img').attr('src');
    if (srcset) {
      const sources = srcset.split(',')
        .map((s) => s.trim().split(' '))
        .filter(([, size]) => !isNaN(parseInt(size)))
        .map(([url, size]) => ({ url, size: parseInt(size) }))
        .sort((a, b) => b.size - a.size);
      if (sources.length > 0) imageUrl = sources[0].url;
    }
    return { sku: barcode, name: item.value, image_src: imageUrl, barcode };
  } catch (e) {
    return null;
  }
}

router.get('/fetch-missing-images', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 20;
    const products = await sequelize.query(
      `SELECT image, sku FROM products WHERE is_active = 1 AND (image IS NULL OR image = '') LIMIT ?`,
      { type: QueryTypes.SELECT, replacements: [limit] }
    );

    if (products.length === 0) {
      return successResponse(res, [], 'No images to download');
    }

    const results = [];
    for (const product of products) {
      try {
        const productInfo = await fetchProductByBarcode(product.sku);
        if (productInfo?.image_src) {
          results.push({ sku: product.sku, name: productInfo.name, image: productInfo.image_src, status: 'fetched' });
        } else {
          await sequelize.query("UPDATE products SET image = 'not' WHERE sku = ?", { replacements: [product.sku] });
          results.push({ sku: product.sku, status: 'not_found' });
        }
      } catch (err) {
        results.push({ sku: product.sku, status: 'error', error: err.message });
      }
    }
    successResponse(res, results, 'Image fetch process completed');
  } catch (err) {
    errorResponse(res, err.message);
  }
});

module.exports = router;
