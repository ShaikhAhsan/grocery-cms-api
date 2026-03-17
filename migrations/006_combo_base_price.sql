-- =============================================================================
-- Sheen CMS - Combo base price (fixed price for combo addon, extras on top)
-- Migration: 006_combo_base_price
-- combo_base_price = price when selecting defaults (e.g. Soft Drink + Fries = 150)
-- price_adjustment on items = extra when selecting non-default (e.g. Fresh Lime +310)
-- =============================================================================

ALTER TABLE combo_rules
  ADD COLUMN combo_base_price DECIMAL(10,2) NOT NULL DEFAULT 0.00
  AFTER combo_discount_amount;
