const express = require('express');
const productAiRoutes = require('./productAi');
const imageOpsRoutes = require('./imageOps');
const productLinksRoutes = require('./productLinks');
const reportsRoutes = require('./reports');
const schemaCrudRoutes = require('./schemaCrud');

const router = express.Router();

router.use(productAiRoutes);
router.use(imageOpsRoutes);
router.use(productLinksRoutes);
router.use(reportsRoutes);
router.use(schemaCrudRoutes);

module.exports = router;
