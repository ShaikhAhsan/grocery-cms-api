# Al Faisal Menu Seed

Full restaurant menu data from both menu images (Fast Food + Best Deals).

## Run

```bash
npm run seed
```

## Data Summary

| Entity | Count |
|--------|-------|
| Categories | 23 |
| Menu Items | 167 |
| Variation Groups | 40 |
| Combos | 22 |

## Categories

1. Burger, Sandwich, Wings, Pratha Roll, Shawarma
2. Lahori Special Daig's (bulk orders)
3. Fries, Pasta, Bar Menu (drinks, water, chillers)
4. Pizza (14 types + add-ons)
5. Gravies with Rice, Rice and Noodles
6. Chai Shaye, Balochi Sajji
7. BBQ & Grill, Starters, Kids Corner
8. Tandoor, Salads, Sides
9. Karahi's (Chicken, Mutton, Beef)
10. Handi's Chicken (18 types)
11. Best Deals (22 combos)

## Variation Groups

- **Pizza Size** – per item (S/M/L/XL)
- **Fries Size** – per type (Loaded, Mayo Garlic, Masala, Plain, Combo)
- **Wings/Nuggets** – 5PC/10PC, 6PC
- **Portion Half/Full** – multiple price tiers (900-1500, 1300-1900, etc.)
- **Portion BBQ** – Small/Half/Full
- **Soft Drink Size** – Regular, 500ML, 1L, 1.5L, 2.25L
- **Pasta Size** – Medium/Large
- **Balochi Sajji** – Small/Medium/Large

## Combos (Best Deals)

22 combos including Biryani, Zinger Burger, Burger, Pizza, Pratha Roll, and Pasta combos with fries, wings, nuggets, and soft drinks.

## Notes

- Seed clears existing menu data (categories, menu_items, variation_groups, combos, etc.) before inserting
- Each pizza has its own size variation group for correct S/M/L/XL pricing
- Each fries type has its own size group for correct pricing
