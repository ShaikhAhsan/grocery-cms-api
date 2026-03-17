# Migration Changelog

All schema changes are tracked here. Each migration file is run once and recorded in `_migrations`.

---

## 2025-03-05

### 001_restaurant_menu_schema.sql

**Initial restaurant menu schema**

**Tables created (30):**

| Table | Purpose |
|-------|---------|
| categories | Product groupings |
| menu_items | Sellable items |
| variation_groups | Customization types |
| variation_group_items | Choices within groups |
| menu_item_variation_groups | Menu item ↔ variation group link |
| promotions | Discount definitions |
| promotion_items | Promotion applicability |
| seo_metadata | Polymorphic SEO |
| images | Polymorphic images |
| ingredients | Raw materials |
| recipe_items | Menu item recipes |
| stock_movements | Inventory log |
| availability_schedules | Time-based availability |
| dietary_tags | Gluten-Free, Vegan, etc. |
| item_dietary_tags | Item ↔ dietary tag link |
| tax_rates | Tax definitions |
| item_tax_categories | Item/category tax |
| tax_jurisdictions | Location-based tax |
| modifier_rules | Conditional modifier logic |
| combos | Bundle products |
| combo_items | Combo components |
| combo_variation_rules | Combo variation rules |
| customer_groups | Customer segments |
| customer_group_prices | Group-specific pricing |
| loyalty_points_rules | Points per item/category |
| menu_versions | Menu versioning |
| menu_version_items | Version item overrides |
| audit_logs | Change history |
| stations | Kitchen stations |
| item_station_routing | Item → station routing |

---

## Adding New Migrations

1. Create `migrations/002_description.sql`
2. Run `npm run migrate`
3. Update this changelog
