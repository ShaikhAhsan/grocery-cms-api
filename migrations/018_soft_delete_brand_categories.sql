-- Add is_deleted for soft delete (products already expose is_deleted in schema).
-- Run via: npm run migrate

ALTER TABLE `brand` ADD COLUMN `is_deleted` TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE `categories` ADD COLUMN `is_deleted` TINYINT(1) NOT NULL DEFAULT 0;
