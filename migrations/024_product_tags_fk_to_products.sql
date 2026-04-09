-- product_tags must reference `products`, not `new_products`, for CMS/API compatibility.
--
-- 1) Orphans (optional but recommended before ADD CONSTRAINT):
--    DELETE pt FROM product_tags pt
--    LEFT JOIN products p ON p.product_id = pt.product_id
--    WHERE p.product_id IS NULL;
--
-- 2) Replace FK (confirm name with SHOW CREATE TABLE product_tags;):

ALTER TABLE product_tags
  DROP FOREIGN KEY product_tags_ibfk_1;

ALTER TABLE product_tags
  ADD CONSTRAINT product_tags_product_id_fk
  FOREIGN KEY (product_id) REFERENCES products (product_id)
  ON DELETE CASCADE;
