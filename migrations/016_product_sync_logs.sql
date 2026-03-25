-- One row per POST /sync_products (bulk upsert) completion.
CREATE TABLE IF NOT EXISTS product_sync_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  total_records INT UNSIGNED NOT NULL DEFAULT 0,
  new_count INT UNSIGNED NOT NULL DEFAULT 0,
  updated_count INT UNSIGNED NOT NULL DEFAULT 0,
  unchanged_count INT UNSIGNED NOT NULL DEFAULT 0,
  client_ip VARCHAR(45) NULL,
  PRIMARY KEY (id),
  KEY idx_product_sync_logs_synced_at (synced_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
