-- =============================================================================
-- Sheen CMS - Featured Categories & Products (Uber Eats style)
-- Migration: 007_featured
-- Idempotent: skips if columns already exist
-- =============================================================================

DROP PROCEDURE IF EXISTS _migrate_007_featured;
CREATE PROCEDURE _migrate_007_featured()
BEGIN
  IF (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories' AND COLUMN_NAME = 'is_featured') = 0 THEN
    ALTER TABLE categories ADD COLUMN is_featured TINYINT(1) NOT NULL DEFAULT 0, ADD COLUMN featured_order INT NOT NULL DEFAULT 0, ADD INDEX idx_categories_featured (is_featured, featured_order);
  END IF;
  IF (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'menu_items' AND COLUMN_NAME = 'is_featured') = 0 THEN
    ALTER TABLE menu_items ADD COLUMN is_featured TINYINT(1) NOT NULL DEFAULT 0, ADD COLUMN featured_order INT NOT NULL DEFAULT 0, ADD INDEX idx_menu_items_featured (is_featured, featured_order);
  END IF;
END;
CALL _migrate_007_featured();
DROP PROCEDURE _migrate_007_featured;
