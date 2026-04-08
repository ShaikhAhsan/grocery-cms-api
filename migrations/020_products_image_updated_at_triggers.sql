-- Maintain image_updated_at only when `image` changes (BEFORE INSERT / UPDATE triggers).
-- Requires column from 019_products_image_updated_at.sql.

DROP TRIGGER IF EXISTS products_image_updated_at_bi;
DROP TRIGGER IF EXISTS products_image_updated_at_bu;

CREATE TRIGGER products_image_updated_at_bi
BEFORE INSERT ON products
FOR EACH ROW
SET NEW.image_updated_at = IF(
  NEW.image IS NOT NULL AND NEW.image != '',
  CURRENT_TIMESTAMP,
  NEW.image_updated_at
);

CREATE TRIGGER products_image_updated_at_bu
BEFORE UPDATE ON products
FOR EACH ROW
SET NEW.image_updated_at = IF(
  NOT (NEW.image <=> OLD.image),
  CURRENT_TIMESTAMP,
  NEW.image_updated_at
);
