-- Column only; triggers in 020_products_image_updated_at_triggers.sql set it when `image` changes.
ALTER TABLE products
  ADD COLUMN image_updated_at DATETIME NULL DEFAULT NULL
    COMMENT 'Last time image or thumb_image was changed'
  AFTER image;
