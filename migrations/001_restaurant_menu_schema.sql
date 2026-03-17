-- =============================================================================
-- Sheen CMS - Restaurant Menu Schema
-- Migration: 001_restaurant_menu_schema
-- Created: 2025-03-05
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. CORE: Categories & Menu Items
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS categories (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  image_url TEXT,
  display_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_categories_active (is_active, is_deleted),
  INDEX idx_categories_display_order (display_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS menu_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  category_id INT UNSIGNED NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  base_price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  image_url TEXT,
  display_order INT NOT NULL DEFAULT 0,
  preparation_time_minutes INT UNSIGNED DEFAULT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  INDEX idx_menu_items_category (category_id),
  INDEX idx_menu_items_active (is_active, is_deleted),
  INDEX idx_menu_items_display_order (display_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 2. VARIATIONS: Groups & Items
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS variation_groups (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  min_selections INT NOT NULL DEFAULT 0,
  max_selections INT NOT NULL DEFAULT 1,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_variation_groups_active (is_active, is_deleted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS variation_group_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  variation_group_id INT UNSIGNED NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  price_adjustment DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  calorie_adjustment INT UNSIGNED DEFAULT NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  display_order INT NOT NULL DEFAULT 0,
  image_url TEXT,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (variation_group_id) REFERENCES variation_groups(id) ON DELETE CASCADE ON UPDATE CASCADE,
  INDEX idx_variation_group_items_group (variation_group_id),
  INDEX idx_variation_group_items_active (is_active, is_deleted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS menu_item_variation_groups (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  menu_item_id INT UNSIGNED NOT NULL,
  variation_group_id INT UNSIGNED NOT NULL,
  display_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (variation_group_id) REFERENCES variation_groups(id) ON DELETE CASCADE ON UPDATE CASCADE,
  UNIQUE KEY uk_menu_item_variation (menu_item_id, variation_group_id),
  INDEX idx_mivg_menu_item (menu_item_id),
  INDEX idx_mivg_variation_group (variation_group_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 3. PROMOTIONS
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS promotions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  discount_type ENUM('percentage', 'fixed_amount', 'buy_x_get_y') NOT NULL,
  discount_value DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  start_date DATETIME DEFAULT NULL,
  end_date DATETIME DEFAULT NULL,
  day_of_week_mask INT UNSIGNED DEFAULT NULL COMMENT 'Bitmask: Mon=1, Tue=2, Wed=4, Thu=8, Fri=16, Sat=32, Sun=64',
  start_time TIME DEFAULT NULL,
  end_time TIME DEFAULT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_promotions_active (is_active, is_deleted),
  INDEX idx_promotions_dates (start_date, end_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS promotion_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  promotion_id INT UNSIGNED NOT NULL,
  applicable_type ENUM('category', 'menu_item', 'variation_group') NOT NULL,
  applicable_id INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (promotion_id) REFERENCES promotions(id) ON DELETE CASCADE ON UPDATE CASCADE,
  INDEX idx_promotion_items_promotion (promotion_id),
  INDEX idx_promotion_items_applicable (applicable_type, applicable_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 4. SEO & MEDIA
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS seo_metadata (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_type ENUM('category', 'menu_item', 'variation_group') NOT NULL,
  entity_id INT UNSIGNED NOT NULL,
  meta_title VARCHAR(255),
  meta_description TEXT,
  meta_keywords TEXT,
  slug VARCHAR(255),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_seo_entity (entity_type, entity_id),
  INDEX idx_seo_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS images (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_type ENUM('category', 'menu_item', 'variation_group_item') NOT NULL,
  entity_id INT UNSIGNED NOT NULL,
  image_url TEXT NOT NULL,
  alt_text VARCHAR(255),
  display_order INT NOT NULL DEFAULT 0,
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_images_entity (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 5. INVENTORY & STOCK
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ingredients (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  unit_of_measure VARCHAR(50) NOT NULL DEFAULT 'unit',
  stock_quantity DECIMAL(12,4) NOT NULL DEFAULT 0,
  reorder_level DECIMAL(12,4) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_ingredients_active (is_active, is_deleted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recipe_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  menu_item_id INT UNSIGNED NOT NULL,
  ingredient_id INT UNSIGNED NOT NULL,
  quantity_used DECIMAL(12,4) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (ingredient_id) REFERENCES ingredients(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  UNIQUE KEY uk_recipe_item (menu_item_id, ingredient_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stock_movements (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ingredient_id INT UNSIGNED NOT NULL,
  change_quantity DECIMAL(12,4) NOT NULL,
  reason VARCHAR(100) NOT NULL COMMENT 'e.g. purchase, usage, adjustment',
  reference_id INT UNSIGNED DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ingredient_id) REFERENCES ingredients(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  INDEX idx_stock_movements_ingredient (ingredient_id),
  INDEX idx_stock_movements_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 6. AVAILABILITY SCHEDULES
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS availability_schedules (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_type ENUM('category', 'menu_item', 'variation_group') NOT NULL,
  entity_id INT UNSIGNED NOT NULL,
  day_of_week_mask INT UNSIGNED NOT NULL COMMENT 'Bitmask: Mon=1, Tue=2, Wed=4, Thu=8, Fri=16, Sat=32, Sun=64',
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  start_date DATE DEFAULT NULL,
  end_date DATE DEFAULT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_availability_entity (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 7. DIETARY & ALLERGENS
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS dietary_tags (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  icon_url TEXT,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_dietary_tag_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS item_dietary_tags (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_type ENUM('menu_item', 'variation_group_item') NOT NULL,
  entity_id INT UNSIGNED NOT NULL,
  dietary_tag_id INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (dietary_tag_id) REFERENCES dietary_tags(id) ON DELETE CASCADE ON UPDATE CASCADE,
  UNIQUE KEY uk_item_dietary (entity_type, entity_id, dietary_tag_id),
  INDEX idx_item_dietary_entity (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 8. TAX RULES
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tax_rates (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  rate DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS item_tax_categories (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_type ENUM('category', 'menu_item') NOT NULL,
  entity_id INT UNSIGNED NOT NULL,
  tax_rate_id INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (tax_rate_id) REFERENCES tax_rates(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  UNIQUE KEY uk_item_tax (entity_type, entity_id),
  INDEX idx_item_tax_entity (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tax_jurisdictions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  country VARCHAR(100) NOT NULL,
  state VARCHAR(100) DEFAULT NULL,
  city VARCHAR(100) DEFAULT NULL,
  tax_rate_id INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (tax_rate_id) REFERENCES tax_rates(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  INDEX idx_tax_jurisdiction_location (country, state, city)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 9. MODIFIER RULES (Advanced dependencies)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS modifier_rules (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  rule_type ENUM('requires', 'excludes', 'enables') NOT NULL,
  condition_group_id INT UNSIGNED NOT NULL,
  condition_item_id INT UNSIGNED DEFAULT NULL,
  target_group_id INT UNSIGNED NOT NULL,
  target_item_id INT UNSIGNED DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (condition_group_id) REFERENCES variation_groups(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (condition_item_id) REFERENCES variation_group_items(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (target_group_id) REFERENCES variation_groups(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (target_item_id) REFERENCES variation_group_items(id) ON DELETE CASCADE ON UPDATE CASCADE,
  INDEX idx_modifier_rules_condition (condition_group_id, condition_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 10. COMBO / BUNDLE MEALS
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS combos (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  base_price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  image_url TEXT,
  display_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_combos_active (is_active, is_deleted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS combo_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  combo_id INT UNSIGNED NOT NULL,
  menu_item_id INT UNSIGNED NOT NULL,
  min_quantity INT UNSIGNED NOT NULL DEFAULT 1,
  max_quantity INT UNSIGNED NOT NULL DEFAULT 1,
  display_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (combo_id) REFERENCES combos(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  INDEX idx_combo_items_combo (combo_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS combo_variation_rules (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  combo_id INT UNSIGNED NOT NULL,
  menu_item_id INT UNSIGNED NOT NULL,
  variation_group_id INT UNSIGNED NOT NULL,
  is_allowed TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (combo_id) REFERENCES combos(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (variation_group_id) REFERENCES variation_groups(id) ON DELETE CASCADE ON UPDATE CASCADE,
  UNIQUE KEY uk_combo_variation (combo_id, menu_item_id, variation_group_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 11. CUSTOMER & LOYALTY
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS customer_groups (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_group_prices (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_group_id INT UNSIGNED NOT NULL,
  menu_item_id INT UNSIGNED NOT NULL,
  special_price DECIMAL(10,2) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_group_id) REFERENCES customer_groups(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE ON UPDATE CASCADE,
  UNIQUE KEY uk_customer_group_price (customer_group_id, menu_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS loyalty_points_rules (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_type ENUM('category', 'menu_item') NOT NULL,
  entity_id INT UNSIGNED NOT NULL,
  points_per_unit INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_loyalty_entity (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 12. MENU VERSIONING
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS menu_versions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  start_date DATE DEFAULT NULL,
  end_date DATE DEFAULT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_menu_versions_dates (start_date, end_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS menu_version_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  menu_version_id INT UNSIGNED NOT NULL,
  menu_item_id INT UNSIGNED NOT NULL,
  override_price DECIMAL(10,2) DEFAULT NULL,
  is_visible TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (menu_version_id) REFERENCES menu_versions(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE ON UPDATE CASCADE,
  UNIQUE KEY uk_menu_version_item (menu_version_id, menu_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 13. AUDIT LOG
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  table_name VARCHAR(100) NOT NULL,
  record_id INT UNSIGNED NOT NULL,
  action ENUM('INSERT', 'UPDATE', 'DELETE') NOT NULL,
  old_data JSON DEFAULT NULL,
  new_data JSON DEFAULT NULL,
  user_id VARCHAR(100) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_table_record (table_name, record_id),
  INDEX idx_audit_created (created_at),
  INDEX idx_audit_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 14. KITCHEN DISPLAY & ROUTING
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS stations (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS item_station_routing (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_type ENUM('menu_item', 'variation_group_item') NOT NULL,
  entity_id INT UNSIGNED NOT NULL,
  station_id INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (station_id) REFERENCES stations(id) ON DELETE CASCADE ON UPDATE CASCADE,
  UNIQUE KEY uk_item_station (entity_type, entity_id, station_id),
  INDEX idx_item_station_entity (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
