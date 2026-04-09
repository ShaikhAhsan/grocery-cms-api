-- Align product_categories with the CMS/API (all product CRUD uses `products`, not `new_products`).
--
-- If you see:
--   FOREIGN KEY (product_id) REFERENCES `new_products` (`product_id`)
-- then INSERT into product_categories fails for any product_id that exists only in `products`.
--
-- Before running:
--   1) Confirm constraint name (may differ on your DB):
--      SHOW CREATE TABLE product_categories;
--   2) Remove orphan rows that have no matching `products.product_id`:
--      DELETE pc FROM product_categories pc
--      LEFT JOIN products p ON p.product_id = pc.product_id
--      WHERE p.product_id IS NULL;
--
-- Then run the ALTERs below (replace DROP name if different).

ALTER TABLE product_categories
  DROP FOREIGN KEY product_categories_ibfk_1;

ALTER TABLE product_categories
  ADD CONSTRAINT product_categories_product_id_fk
  FOREIGN KEY (product_id) REFERENCES products (product_id)
  ON DELETE CASCADE;
