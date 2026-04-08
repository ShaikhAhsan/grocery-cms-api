/**
 * Normalize `sheen_inventory_access.is_cost_price_visible` from MySQL / Sequelize.
 *
 * `!!Number(value)` is wrong for boolean `true` (`Number(true)` → NaN) and some Buffer forms.
 */
function parseIsCostPriceVisible(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value == null) return false;
  if (typeof value === 'bigint') return value !== 0n;
  if (Buffer.isBuffer(value)) {
    for (let i = 0; i < value.length; i += 1) {
      if (value[i] !== 0) return true;
    }
    return false;
  }
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    if (s === '1' || s === 'true' || s === 'yes') return true;
    if (s === '0' || s === 'false' || s === 'no' || s === '') return false;
  }
  const n = Number(value);
  if (Number.isFinite(n)) return n !== 0;
  return false;
}

module.exports = { parseIsCostPriceVisible };
