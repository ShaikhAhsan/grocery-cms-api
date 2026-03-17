-- =============================================================================
-- Sheen CMS - Combo Groups (Uber Eats style: pick 1 from each group)
-- Migration: 002_combo_groups
-- =============================================================================

-- Combo groups: each group = "pick 1 item" (e.g. Main, Side, Drink)
CREATE TABLE IF NOT EXISTS combo_groups (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  combo_id INT UNSIGNED NOT NULL,
  name VARCHAR(255) NOT NULL,
  min_selections INT NOT NULL DEFAULT 1,
  max_selections INT NOT NULL DEFAULT 1,
  display_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (combo_id) REFERENCES combos(id) ON DELETE CASCADE ON UPDATE CASCADE,
  INDEX idx_combo_groups_combo (combo_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Combo group items: actual menu items in each group. is_default = included in base price.
-- price_adjustment = add this when user picks this item instead of default
CREATE TABLE IF NOT EXISTS combo_group_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  combo_group_id INT UNSIGNED NOT NULL,
  menu_item_id INT UNSIGNED NOT NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  price_adjustment DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  display_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (combo_group_id) REFERENCES combo_groups(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  INDEX idx_combo_group_items_group (combo_group_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
