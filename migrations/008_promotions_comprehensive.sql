-- =============================================================================
-- Sheen CMS - Comprehensive Promotions
-- Migration: 008_promotions_comprehensive
-- Idempotent: adds each column only if it doesn't exist
-- =============================================================================

DROP PROCEDURE IF EXISTS _migrate_008_promotions;
CREATE PROCEDURE _migrate_008_promotions()
BEGIN
  IF (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'promotions' AND COLUMN_NAME = 'promotion_trigger') = 0 THEN
    ALTER TABLE promotions ADD COLUMN promotion_trigger ENUM('auto_apply','coupon') NOT NULL DEFAULT 'auto_apply' AFTER description;
  END IF;
  IF (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'promotions' AND COLUMN_NAME = 'coupon_code') = 0 THEN
    ALTER TABLE promotions ADD COLUMN coupon_code VARCHAR(50) NULL AFTER promotion_trigger;
  END IF;
  IF (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'promotions' AND COLUMN_NAME = 'coupon_expires_at') = 0 THEN
    ALTER TABLE promotions ADD COLUMN coupon_expires_at DATETIME NULL AFTER coupon_code;
  END IF;
  IF (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'promotions' AND COLUMN_NAME = 'max_uses_total') = 0 THEN
    ALTER TABLE promotions ADD COLUMN max_uses_total INT UNSIGNED NULL AFTER coupon_expires_at;
  END IF;
  IF (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'promotions' AND COLUMN_NAME = 'max_uses_per_customer') = 0 THEN
    ALTER TABLE promotions ADD COLUMN max_uses_per_customer INT UNSIGNED NULL DEFAULT 1 AFTER max_uses_total;
  END IF;
  IF (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'promotions' AND COLUMN_NAME = 'applicable_to') = 0 THEN
    ALTER TABLE promotions ADD COLUMN applicable_to ENUM('order','category','menu_item','variation_group') NOT NULL DEFAULT 'order' AFTER discount_value;
  END IF;
  IF (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'promotions' AND COLUMN_NAME = 'min_order_value') = 0 THEN
    ALTER TABLE promotions ADD COLUMN min_order_value DECIMAL(10,2) NULL DEFAULT NULL AFTER applicable_to;
  END IF;
  IF (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'promotions' AND COLUMN_NAME = 'max_discount_amount') = 0 THEN
    ALTER TABLE promotions ADD COLUMN max_discount_amount DECIMAL(10,2) NULL AFTER min_order_value;
  END IF;
  IF (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'promotions' AND COLUMN_NAME = 'buy_quantity') = 0 THEN
    ALTER TABLE promotions ADD COLUMN buy_quantity INT UNSIGNED NULL DEFAULT NULL AFTER max_discount_amount;
  END IF;
  IF (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'promotions' AND COLUMN_NAME = 'get_quantity') = 0 THEN
    ALTER TABLE promotions ADD COLUMN get_quantity INT UNSIGNED NULL DEFAULT NULL AFTER buy_quantity;
  END IF;
  IF (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'promotions' AND COLUMN_NAME = 'get_discount_type') = 0 THEN
    ALTER TABLE promotions ADD COLUMN get_discount_type ENUM('free','percentage','fixed') NULL AFTER get_quantity;
  END IF;
  IF (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'promotions' AND COLUMN_NAME = 'get_discount_value') = 0 THEN
    ALTER TABLE promotions ADD COLUMN get_discount_value DECIMAL(10,2) NULL DEFAULT NULL AFTER get_discount_type;
  END IF;
END;
CALL _migrate_008_promotions();
DROP PROCEDURE _migrate_008_promotions;
