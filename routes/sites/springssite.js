/**
 * Springs site - fetch missing product images from springs.com.pk
 */
const express = require('express');
const { sequelize } = require('../../config/database');
const { QueryTypes } = require('sequelize');
const { successResponse, errorResponse } = require('../../utils/responseHandler');
const { publicApiErrorMessage } = require('../../utils/publicApiErrorMessage');

const router = express.Router();

async function fetchProductByBarcode(barcode) {
  const url = `https://app.cloudsearchapp.com/api/v1/search?shop=springwebworks-7809.myshopify.com&q=${barcode}&lang=en&country=sa`;
  try {
    const response = await fetch(url, {
      headers: { accept: '*/*', 'user-agent': 'Mozilla/5.0' },
    });
    const data = await response.json();
    if (data.products?.length > 0) {
      const p = data.products[0];
      return {
        sku: p.sku,
        name: p.name,
        image_src: (p.image_src || '').replace('_300x300', ''),
        barcode,
      };
    }
    return null;
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
        results.push({ sku: product.sku, status: 'error', error: publicApiErrorMessage(err) });
      }
    }
    successResponse(res, results, 'Image fetch process completed');
  } catch (err) {
    errorResponse(res, err);
  }
});

module.exports = router;
