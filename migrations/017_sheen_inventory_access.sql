-- Sheen Inventory app: Firebase users request access; admin approves in CMS (sheen-inventory-access CRUD).
CREATE TABLE IF NOT EXISTS sheen_inventory_access (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  firebase_uid VARCHAR(128) NOT NULL,
  email VARCHAR(255) NOT NULL,
  display_name VARCHAR(255) NULL,
  status ENUM('pending', 'approved', 'rejected', 'revoked') NOT NULL DEFAULT 'pending',
  requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMP NULL DEFAULT NULL,
  reviewed_by VARCHAR(255) NULL,
  notes TEXT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sheen_inv_firebase_uid (firebase_uid),
  KEY idx_she_email (email),
  KEY idx_she_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
