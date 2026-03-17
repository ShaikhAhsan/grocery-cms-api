-- Add featured_order if missing (e.g. is_featured exists but featured_order doesn't)
-- Idempotent: skips if column already exists

DROP PROCEDURE IF EXISTS _migrate_010_featured_order;
CREATE PROCEDURE _migrate_010_featured_order()
BEGIN
  IF (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories' AND COLUMN_NAME = 'featured_order') = 0 THEN
    ALTER TABLE categories ADD COLUMN featured_order INT NOT NULL DEFAULT 0 AFTER is_featured;
  END IF;
  IF (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'menu_items' AND COLUMN_NAME = 'featured_order') = 0 THEN
    ALTER TABLE menu_items ADD COLUMN featured_order INT NOT NULL DEFAULT 0 AFTER is_featured;
  END IF;
END;
CALL _migrate_010_featured_order();
DROP PROCEDURE _migrate_010_featured_order;
