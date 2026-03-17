# Sheen CMS - Restaurant Menu Database Schema

**Database:** `sheen_api_db`  
**Last Updated:** 2025-03-05  
**Migration:** `001_restaurant_menu_schema`

---

## Table Overview

| # | Table | Description |
|---|-------|-------------|
| 1 | `categories` | Product groupings (e.g., Appetizers, Main Course) |
| 2 | `menu_items` | Sellable items with base price |
| 3 | `variation_groups` | Customization types (Size, Sides, Add-ons) |
| 4 | `variation_group_items` | Choices within a group (e.g., Large, White Rice) |
| 5 | `menu_item_variation_groups` | Links menu items to variation groups |
| 6 | `promotions` | Discounts, time-based offers |
| 7 | `promotion_items` | Links promotions to categories/items/groups |
| 8 | `seo_metadata` | Polymorphic SEO for categories, items, groups |
| 9 | `images` | Polymorphic images for entities |
| 10 | `ingredients` | Raw materials for inventory |
| 11 | `recipe_items` | Menu item → ingredient quantities |
| 12 | `stock_movements` | Inventory change log |
| 13 | `availability_schedules` | Time windows for entities |
| 14 | `dietary_tags` | Gluten-Free, Vegan, etc. |
| 15 | `item_dietary_tags` | Links tags to items |
| 16 | `tax_rates` | Tax percentage definitions |
| 17 | `item_tax_categories` | Links items/categories to tax rates |
| 18 | `tax_jurisdictions` | Location-based tax rules |
| 19 | `modifier_rules` | Conditional logic (requires, excludes, enables) |
| 20 | `combos` | Bundle/combo products |
| 21 | `combo_items` | Components of a combo |
| 22 | `combo_variation_rules` | Variation restrictions per combo item |
| 23 | `customer_groups` | VIP, Students, etc. |
| 24 | `customer_group_prices` | Special pricing per group |
| 25 | `loyalty_points_rules` | Points per item/category |
| 26 | `menu_versions` | Seasonal/rotating menus |
| 27 | `menu_version_items` | Items in a menu version |
| 28 | `audit_logs` | Change history |
| 29 | `stations` | Kitchen stations (Grill, Salad) |
| 30 | `item_station_routing` | Item → station assignment |

---

## Entity Relationships

```
categories
    └── menu_items (category_id)
            ├── menu_item_variation_groups → variation_groups
            ├── recipe_items → ingredients
            ├── promotion_items (applicable)
            └── combo_items (for combos)

variation_groups
    ├── variation_group_items
    ├── menu_item_variation_groups
    └── modifier_rules (condition/target)

promotions
    └── promotion_items (→ category, menu_item, variation_group)

combos
    ├── combo_items → menu_items
    └── combo_variation_rules
```

---

## Key Enums

| Table | Column | Values |
|-------|--------|--------|
| `promotions` | discount_type | percentage, fixed_amount, buy_x_get_y |
| `promotion_items` | applicable_type | category, menu_item, variation_group |
| `seo_metadata` | entity_type | category, menu_item, variation_group |
| `images` | entity_type | category, menu_item, variation_group_item |
| `item_dietary_tags` | entity_type | menu_item, variation_group_item |
| `item_tax_categories` | entity_type | category, menu_item |
| `modifier_rules` | rule_type | requires, excludes, enables |
| `item_station_routing` | entity_type | menu_item, variation_group_item |
| `audit_logs` | action | INSERT, UPDATE, DELETE |

---

## Day of Week Bitmask

For `day_of_week_mask` and `availability_schedules.day_of_week_mask`:

| Day | Value |
|-----|-------|
| Monday | 1 |
| Tuesday | 2 |
| Wednesday | 4 |
| Thursday | 8 |
| Friday | 16 |
| Saturday | 32 |
| Sunday | 64 |

Example: Mon–Fri = 1+2+4+8+16 = 31

---

## Migration History

| Migration | Description | Date |
|-----------|-------------|------|
| 001_restaurant_menu_schema | Initial restaurant menu schema (30 tables) | 2025-03-05 |

---

## Running Migrations

```bash
cd sheen-cms-api
node scripts/runMigrations.js
```

Or add to package.json:

```json
"migrate": "node scripts/runMigrations.js"
```
