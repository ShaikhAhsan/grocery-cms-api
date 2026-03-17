-- =============================================================================
-- Sheen CMS - Product Variants with Nested/Conditional Groups
-- Migration: 004_product_variants_nested
-- Supports: Layer 1 (e.g. Fajita Pizza sizes) -> Layer 2 (toppings per size)
-- Variation group items can be full products with base_price + station
-- =============================================================================

-- 1. Extend variation_group_items: product items with full price + station
ALTER TABLE variation_group_items
  ADD COLUMN base_price DECIMAL(10,2) NULL DEFAULT NULL AFTER price_adjustment,
  ADD COLUMN station_id INT UNSIGNED NULL DEFAULT NULL AFTER base_price,
  ADD COLUMN is_product_item TINYINT(1) NOT NULL DEFAULT 0 AFTER station_id;

ALTER TABLE variation_group_items
  ADD CONSTRAINT fk_variation_group_items_station
  FOREIGN KEY (station_id) REFERENCES stations(id) ON DELETE SET NULL ON UPDATE CASCADE;

-- When is_product_item=1: base_price is the full product price (e.g. Fajita Small 580)
-- When is_product_item=0: use price_adjustment as before

-- 2. Conditional child groups: when parent item selected, show child group
-- e.g. Select "Fajita Pizza Small" -> show "Toppings Small" group
CREATE TABLE IF NOT EXISTS variation_group_dependencies (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  parent_variation_group_item_id INT UNSIGNED NOT NULL,
  child_variation_group_id INT UNSIGNED NOT NULL,
  display_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (parent_variation_group_item_id) REFERENCES variation_group_items(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (child_variation_group_id) REFERENCES variation_groups(id) ON DELETE CASCADE ON UPDATE CASCADE,
  UNIQUE KEY uk_vg_dep (parent_variation_group_item_id, child_variation_group_id),
  INDEX idx_vg_dep_parent (parent_variation_group_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Size-dependent addon pricing (when one addon group, different prices per size)
-- e.g. Extra Cheese: +30 for Small, +50 for Medium, +70 for Large
CREATE TABLE IF NOT EXISTS variation_group_item_price_context (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  variation_group_item_id INT UNSIGNED NOT NULL COMMENT 'The addon item (e.g. Extra Cheese)',
  context_variation_group_item_id INT UNSIGNED NOT NULL COMMENT 'When this parent is selected (e.g. Fajita Small)',
  price_adjustment DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (variation_group_item_id) REFERENCES variation_group_items(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (context_variation_group_item_id) REFERENCES variation_group_items(id) ON DELETE CASCADE ON UPDATE CASCADE,
  UNIQUE KEY uk_vg_item_price_ctx (variation_group_item_id, context_variation_group_item_id),
  INDEX idx_vg_ipc_context (context_variation_group_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
