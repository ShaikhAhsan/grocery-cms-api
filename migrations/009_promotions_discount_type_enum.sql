-- Extend promotions.discount_type enum with new values
ALTER TABLE promotions
  MODIFY COLUMN discount_type ENUM(
    'percentage',
    'fixed_amount',
    'percentage_capped',
    'buy_x_get_y',
    'buy_x_get_y_pct',
    'bogo',
    'bundle_discount'
  ) NOT NULL DEFAULT 'percentage';
