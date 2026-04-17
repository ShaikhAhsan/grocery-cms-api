/**
 * Backward-compatible shim.
 * New modular admin routes live under routes/admin/* and are composed in routes/admin/index.js.
 */
module.exports = require('./admin/index');
