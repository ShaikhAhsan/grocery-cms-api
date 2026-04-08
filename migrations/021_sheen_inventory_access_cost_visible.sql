-- Per-user flag: whether Sheen Inventory app may show cost / cost price in UI.
ALTER TABLE sheen_inventory_access
  ADD COLUMN is_cost_price_visible TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '1 = user may see cost price in inventory app'
    AFTER status;
