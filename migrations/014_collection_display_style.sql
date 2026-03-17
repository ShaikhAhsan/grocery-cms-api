-- Add display_style to collections: horizontal_scroll (default) | carousel
-- Migration: 014_collection_display_style

DROP PROCEDURE IF EXISTS _migrate_014_display_style;
CREATE PROCEDURE _migrate_014_display_style()
BEGIN
  IF (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'collections' AND COLUMN_NAME = 'display_style') = 0 THEN
    ALTER TABLE collections ADD COLUMN display_style VARCHAR(32) NOT NULL DEFAULT 'horizontal_scroll' COMMENT 'horizontal_scroll | carousel' AFTER display_order;
  END IF;
END;
CALL _migrate_014_display_style();
DROP PROCEDURE _migrate_014_display_style;
