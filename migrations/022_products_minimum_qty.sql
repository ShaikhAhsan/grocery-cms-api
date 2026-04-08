-- Reorder / minimum stock target for inventory workflows (0 = not used).
ALTER TABLE products
  ADD COLUMN minimum_qty INT UNSIGNED NOT NULL DEFAULT 0
    COMMENT 'Target minimum stock; Sheen Inventory highlights when stock falls short'
  AFTER stock_quantity;
