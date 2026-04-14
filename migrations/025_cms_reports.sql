CREATE TABLE IF NOT EXISTS `cms_reports` (
  `report_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(160) NOT NULL,
  `slug` VARCHAR(180) NOT NULL,
  `report_type` VARCHAR(24) NOT NULL DEFAULT 'list',
  `title_input_key` VARCHAR(80) NULL,
  `inputs_json` LONGTEXT NOT NULL,
  `image_columns_json` LONGTEXT NULL,
  `query_sql` LONGTEXT NOT NULL,
  `show_on_dashboard` TINYINT(1) NOT NULL DEFAULT 1,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`report_id`),
  UNIQUE KEY `uk_cms_reports_slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
