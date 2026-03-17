-- =============================================================================
-- Sheen CMS - Generic Collections (Promotions, Featured, Best Deals, etc.)
-- Migration: 011_collections
-- Create titled sections; add products to multiple collections
-- =============================================================================

CREATE TABLE IF NOT EXISTS collections (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL COMMENT 'Internal name/slug',
  title VARCHAR(255) NOT NULL COMMENT 'Display title on Menu Preview',
  description TEXT,
  image_url TEXT,
  display_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_collections_active (is_active, is_deleted),
  INDEX idx_collections_display_order (display_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS collection_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  collection_id INT UNSIGNED NOT NULL,
  menu_item_id INT UNSIGNED NOT NULL,
  display_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE ON UPDATE CASCADE,
  UNIQUE KEY uk_collection_menu_item (collection_id, menu_item_id),
  INDEX idx_collection_items_collection (collection_id),
  INDEX idx_collection_items_display_order (display_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
