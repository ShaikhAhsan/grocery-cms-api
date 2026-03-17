-- Remove featured columns (replaced by Collections)
-- Migration: 012_drop_featured_columns

DROP PROCEDURE IF EXISTS _migrate_012_drop_featured;
CREATE PROCEDURE _migrate_012_drop_featured()
BEGIN
  IF (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories' AND INDEX_NAME = 'idx_categories_featured') > 0 THEN
    ALTER TABLE categories DROP INDEX idx_categories_featured;
  END IF;
  IF (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories' AND COLUMN_NAME = 'is_featured') > 0 THEN
    ALTER TABLE categories DROP COLUMN is_featured, DROP COLUMN featured_order;
  END IF;
  IF (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'menu_items' AND INDEX_NAME = 'idx_menu_items_featured') > 0 THEN
    ALTER TABLE menu_items DROP INDEX idx_menu_items_featured;
  END IF;
  IF (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'menu_items' AND COLUMN_NAME = 'is_featured') > 0 THEN
    ALTER TABLE menu_items DROP COLUMN is_featured, DROP COLUMN featured_order;
  END IF;
END;
CALL _migrate_012_drop_featured();
DROP PROCEDURE _migrate_012_drop_featured;
