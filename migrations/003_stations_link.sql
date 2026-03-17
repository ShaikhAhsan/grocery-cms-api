-- =============================================================================
-- Sheen CMS - Stations Link (mandatory station for menu items & combos)
-- Migration: 003_stations_link
-- =============================================================================

-- Seed stations (run only if empty)
INSERT INTO stations (name, description, is_active)
SELECT * FROM (
  SELECT 'Cold Drinks' AS name, 'Soft drinks, water, chillers' AS description, 1 AS is_active
  UNION SELECT 'Hot Drinks', 'Chai, tea, karak', 1
  UNION SELECT 'Pizza', 'Pizza preparation', 1
  UNION SELECT 'Burgers & Grill', 'Burgers, sandwiches, rolls, shawarma', 1
  UNION SELECT 'Fryer', 'Fries, wings, nuggets, crispy items', 1
  UNION SELECT 'Karahi', 'Karahi dishes', 1
  UNION SELECT 'Handi', 'Handi dishes', 1
  UNION SELECT 'BBQ', 'BBQ, grill, kebabs, Balochi Sajji', 1
  UNION SELECT 'Pasta', 'Pasta dishes', 1
  UNION SELECT 'Rice & Biryani', 'Rice, biryani, gravies, daig', 1
  UNION SELECT 'Tandoor', 'Naan, roti', 1
  UNION SELECT 'Sides & Salads', 'Raita, salads, sides', 1
  UNION SELECT 'Starters', 'Appetizers, starters', 1
) AS tmp
WHERE NOT EXISTS (SELECT 1 FROM stations LIMIT 1);

-- Add station_id to menu_items (mandatory for routing)
ALTER TABLE menu_items
  ADD COLUMN station_id INT UNSIGNED NULL AFTER category_id;

ALTER TABLE menu_items
  ADD CONSTRAINT fk_menu_items_station
  FOREIGN KEY (station_id) REFERENCES stations(id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill existing menu_items with default station if any exist
UPDATE menu_items m
INNER JOIN stations s ON s.name = 'Burgers & Grill'
SET m.station_id = s.id
WHERE m.station_id IS NULL;

-- Make station_id mandatory
ALTER TABLE menu_items
  MODIFY COLUMN station_id INT UNSIGNED NOT NULL;

-- Add station_id to combos (for deals - primary station for KDS display)
ALTER TABLE combos
  ADD COLUMN station_id INT UNSIGNED NULL AFTER display_order;

ALTER TABLE combos
  ADD CONSTRAINT fk_combos_station
  FOREIGN KEY (station_id) REFERENCES stations(id) ON DELETE RESTRICT ON UPDATE CASCADE;

UPDATE combos c
INNER JOIN stations s ON s.name = 'Burgers & Grill'
SET c.station_id = s.id
WHERE c.station_id IS NULL;

ALTER TABLE combos
  MODIFY COLUMN station_id INT UNSIGNED NOT NULL;
