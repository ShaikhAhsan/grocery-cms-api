-- =============================================================================
-- Sheen CMS - Combo Rules (upsell: add Drink + Side when adding certain items)
-- Migration: 005_combo_rules
-- When user adds an item with a combo rule, show offer to add addons as combo
-- =============================================================================

-- Combo rules: when to show the combo upsell (by menu_item or category)
CREATE TABLE IF NOT EXISTS combo_rules (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  trigger_type ENUM('menu_item', 'category') NOT NULL DEFAULT 'menu_item',
  trigger_id INT UNSIGNED NOT NULL COMMENT 'menu_item_id or category_id',
  combo_discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT 'Discount when adding as combo',
  display_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_combo_rules_trigger (trigger_type, trigger_id),
  INDEX idx_combo_rules_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Groups within a rule (e.g. Drink, Side)
CREATE TABLE IF NOT EXISTS combo_rule_groups (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  combo_rule_id INT UNSIGNED NOT NULL,
  name VARCHAR(255) NOT NULL,
  min_selections INT NOT NULL DEFAULT 1,
  max_selections INT NOT NULL DEFAULT 1,
  display_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (combo_rule_id) REFERENCES combo_rules(id) ON DELETE CASCADE ON UPDATE CASCADE,
  INDEX idx_combo_rule_groups_rule (combo_rule_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Menu items in each group (options to choose from)
CREATE TABLE IF NOT EXISTS combo_rule_group_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  combo_rule_group_id INT UNSIGNED NOT NULL,
  menu_item_id INT UNSIGNED NOT NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  price_adjustment DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  display_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (combo_rule_group_id) REFERENCES combo_rule_groups(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  INDEX idx_crgi_group (combo_rule_group_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
