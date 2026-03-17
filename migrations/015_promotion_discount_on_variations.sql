-- =============================================================================
-- Sheen CMS - Promotion: discount on variations setting
-- Migration: 015_promotion_discount_on_variations
-- Adds discount_on_variations: when 0, discount applies to base price only
-- =============================================================================

DROP PROCEDURE IF EXISTS _migrate_015_discount_on_variations;
CREATE PROCEDURE _migrate_015_discount_on_variations()
BEGIN
  IF (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'promotions' AND COLUMN_NAME = 'discount_on_variations') = 0 THEN
    ALTER TABLE promotions ADD COLUMN discount_on_variations TINYINT(1) NOT NULL DEFAULT 1
      COMMENT '1=apply discount to full price (base+variations), 0=base price only'
      AFTER max_discount_amount;
  END IF;
END;
CALL _migrate_015_discount_on_variations();
DROP PROCEDURE _migrate_015_discount_on_variations;
