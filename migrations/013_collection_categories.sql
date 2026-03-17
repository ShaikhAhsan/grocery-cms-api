-- Add collection_categories - collections can contain categories too
-- Migration: 013_collection_categories

CREATE TABLE IF NOT EXISTS collection_categories (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  collection_id INT UNSIGNED NOT NULL,
  category_id INT UNSIGNED NOT NULL,
  display_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE ON UPDATE CASCADE,
  UNIQUE KEY uk_collection_category (collection_id, category_id),
  INDEX idx_collection_categories_collection (collection_id),
  INDEX idx_collection_categories_display_order (display_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
