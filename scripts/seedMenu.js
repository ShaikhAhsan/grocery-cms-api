#!/usr/bin/env node
/**
 * Seed full Al Faisal restaurant menu
 * Combines both menu images - Fast Food + Best Deals
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const dbConfig = {
  host: process.env.DB_HOST || 'srv1149167.hstgr.cloud',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'sheen_api_user',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'sheen_api_db',
  multipleStatements: true,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
};

// ID maps (populated after inserts)
const ids = { categories: {}, variationGroups: {}, variationItems: {}, menuItems: {}, stations: {} };

async function run() {
  const conn = await mysql.createConnection(dbConfig);
  console.log('Connected to', dbConfig.database);

    try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    try {
      await conn.query('TRUNCATE TABLE combo_rule_group_items');
      await conn.query('TRUNCATE TABLE combo_rule_groups');
      await conn.query('TRUNCATE TABLE combo_rules');
    } catch (_) { /* tables may not exist */ }
    await conn.query('TRUNCATE TABLE combo_group_items');
    await conn.query('TRUNCATE TABLE combo_groups');
    await conn.query('TRUNCATE TABLE combo_variation_rules');
    await conn.query('TRUNCATE TABLE combo_items');
    await conn.query('TRUNCATE TABLE combos');
    await conn.query('TRUNCATE TABLE menu_item_variation_groups');
    await conn.query('TRUNCATE TABLE variation_group_dependencies');
    await conn.query('TRUNCATE TABLE variation_group_item_price_context');
    await conn.query('TRUNCATE TABLE variation_group_items');
    await conn.query('TRUNCATE TABLE recipe_items');
    await conn.query('TRUNCATE TABLE menu_items');
    await conn.query('TRUNCATE TABLE variation_groups');
    await conn.query('TRUNCATE TABLE categories');
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('Cleared existing menu data');
  } catch (e) {
    console.warn('Truncate warning:', e.message);
  }

  try {
    // ========== 0. STATIONS (ensure exist, load ids) ==========
    const stationNames = [
      'Cold Drinks', 'Hot Drinks', 'Pizza', 'Burgers & Grill', 'Fryer',
      'Karahi', 'Handi', 'BBQ', 'Pasta', 'Rice & Biryani', 'Tandoor',
      'Sides & Salads', 'Starters',
    ];
    for (const name of stationNames) {
      const [rows] = await conn.query('SELECT id FROM stations WHERE name = ?', [name]);
      if (rows.length) {
        ids.stations[name] = rows[0].id;
      } else {
        const [r] = await conn.query(
          'INSERT INTO stations (name, description, is_active) VALUES (?, ?, 1)',
          [name, `${name} station`]
        );
        ids.stations[name] = r.insertId;
      }
    }
    console.log('Stations ready:', Object.keys(ids.stations).length);

    // Category → Station mapping (mandatory for routing)
    const categoryStation = {
      'Burger': 'Burgers & Grill',
      'Sandwich': 'Burgers & Grill',
      'Wings': 'Fryer',
      'Pratha Roll': 'Burgers & Grill',
      'Shawarma': 'Burgers & Grill',
      'Lahori Special Daig\'s': 'Rice & Biryani',
      'Fries': 'Fryer',
      'Pasta': 'Pasta',
      'Bar Menu': 'Cold Drinks',
      'Pizza': 'Pizza',
      'Gravies with Rice': 'Rice & Biryani',
      'Rice and Noodles': 'Rice & Biryani',
      'Chai Shaye': 'Hot Drinks',
      'Balochi Sajji': 'BBQ',
      'BBQ & Grill': 'BBQ',
      'Starters': 'Starters',
      'Kids Corner': 'Burgers & Grill',
      'Tandoor': 'Tandoor',
      'Salads': 'Sides & Salads',
      'Sides': 'Sides & Salads',
      'Karahi\'s': 'Karahi',
      'Handi\'s Chicken': 'Handi',
    };

    // ========== 1. CATEGORIES ==========
    const categories = [
      ['Burger', 'Burgers and sandwiches', 1],
      ['Sandwich', 'Sandwiches', 2],
      ['Wings', 'Chicken wings and nuggets', 3],
      ['Pratha Roll', 'Pratha rolls', 4],
      ['Shawarma', 'Shawarma', 5],
      ['Lahori Special Daig\'s', 'Bulk orders - Biryani, Qorma, Haleem', 6],
      ['Fries', 'French fries', 7],
      ['Pasta', 'Pasta dishes', 8],
      ['Bar Menu', 'Soft drinks, water, chillers', 9],
      ['Pizza', 'Pizzas and add-ons', 10],
      ['Gravies with Rice', 'Chicken gravies with rice', 11],
      ['Rice and Noodles', 'Rice and noodle dishes', 12],
      ['Chai Shaye', 'Tea', 13],
      ['Balochi Sajji', 'Roasted chicken', 14],
      ['BBQ & Grill', 'Kebabs, boti, chops', 15],
      ['Starters', 'Appetizers', 16],
      ['Kids Corner', 'Kids meals', 17],
      ['Tandoor', 'Naan and roti', 18],
      ['Salads', 'Salads', 19],
      ['Sides', 'Raita and sides', 20],
      ['Karahi\'s', 'Chicken, Mutton, Beef Karahi', 21],
      ['Handi\'s Chicken', 'Chicken Handi dishes', 22],
      ['Best Deals', 'Combo meals', 23],
    ];

    for (const [name, desc, order] of categories) {
      const [r] = await conn.query(
        'INSERT INTO categories (name, description, display_order) VALUES (?, ?, ?)',
        [name, desc, order]
      );
      ids.categories[name] = r.insertId;
    }
    console.log('Inserted', categories.length, 'categories');

    // ========== 2. VARIATION GROUPS ==========
    const vGroups = [
      ['Pizza Size', 'Choose pizza size', 1, 1],
      ['Fries Size', 'Choose fries size', 1, 1],
      ['Wings Quantity', 'Number of pieces', 1, 1],
      ['Nuggets Quantity', 'Number of pieces', 1, 1],
      ['Portion Half/Full 900-1500', 'Gravies, Handi', 1, 1],
      ['Portion Half/Full 1300-1900', 'Chicken Karahi', 1, 1],
      ['Portion Half/Full 2200-3200', 'Mutton Karahi', 1, 1],
      ['Portion Half/Full 2300-3300', 'Mutton Karahi Premium', 1, 1],
      ['Portion Half/Full 1800-2600', 'Beef Karahi', 1, 1],
      ['Portion Half/Full 1900-2700', 'Beef Karahi Premium', 1, 1],
      ['Portion Half/Full 600-900', 'Mutton Palao, Chicken Biryani', 1, 1],
      ['Portion Half/Full 550-850', 'Beef Palao', 1, 1],
      ['Portion Half/Full 450-600', 'Sweet Rice', 1, 1],
      ['Portion BBQ', 'Small, half, or full portion', 1, 1],
      ['Daig Serving', 'Serving size for bulk orders', 1, 1],
      ['Soft Drink Size', 'Drink volume', 1, 1],
      ['Water Size', 'Water bottle size', 1, 1],
      ['Pizza Add-On', 'Extra toppings (optional)', 0, 3],
      ['Burger Add-ons', 'Add up to 3 extras', 0, 3],
      ['Balochi Sajji Portion', 'Portion size', 1, 1],
      ['Pasta Size', 'Medium or Large', 1, 1],
      ['Crispy Piece Quantity', 'Number of pieces', 1, 1],
    ];

    for (const [name, desc, minS, maxS] of vGroups) {
      const [r] = await conn.query(
        'INSERT INTO variation_groups (name, description, min_selections, max_selections) VALUES (?, ?, ?, ?)',
        [name, desc, minS, maxS]
      );
      ids.variationGroups[name] = r.insertId;
    }
    console.log('Inserted', vGroups.length, 'variation groups');

    // ========== 3. VARIATION GROUP ITEMS ==========
    const vgItems = {
      'Pizza Size': [
        ['Small', null, 0, 0], ['Medium', null, 0, 1], ['Large', null, 0, 2], ['XL', null, 0, 3],
      ],
      'Fries Size': [
        ['Regular', null, 0, 0], ['Medium', null, 0, 1], ['Large', null, 0, 2], ['Family', null, 0, 3],
      ],
      'Wings Quantity': [
        ['5 PC', null, 0, 0], ['10 PC', null, 0, 1], ['4 PC', null, 0, 2], ['12 PC', null, 0, 3],
      ],
      'Nuggets Quantity': [
        ['5 PC', null, 0, 0], ['10 PC', null, 0, 1], ['6 PC', null, 0, 2],
      ],
      'Portion Half/Full 900-1500': [['Half', 900, 0, 0], ['Full', 1500, 0, 1]],
      'Portion Half/Full 1300-1900': [['Half', 1300, 0, 0], ['Full', 1900, 0, 1]],
      'Portion Half/Full 2200-3200': [['Half', 2200, 0, 0], ['Full', 3200, 0, 1]],
      'Portion Half/Full 2300-3300': [['Half', 2300, 0, 0], ['Full', 3300, 0, 1]],
      'Portion Half/Full 1800-2600': [['Half', 1800, 0, 0], ['Full', 2600, 0, 1]],
      'Portion Half/Full 1900-2700': [['Half', 1900, 0, 0], ['Full', 2700, 0, 1]],
      'Portion Half/Full 600-900': [['Half', 600, 0, 0], ['Full', 900, 0, 1]],
      'Portion Half/Full 550-850': [['Half', 550, 0, 0], ['Full', 850, 0, 1]],
      'Portion Half/Full 450-600': [['Half', 450, 0, 0], ['Full', 600, 0, 1]],
      'Portion BBQ': [
        ['Small', null, 0, 0], ['Half', null, 0, 1], ['Full', null, 0, 2],
      ],
      'Daig Serving': [
        ['8x10 Serving', null, 0, 0], ['10 KG', null, 0, 1],
      ],
      'Soft Drink Size': [
        ['Regular', null, 0, 0], ['500 ML', null, 0, 1], ['1 L', null, 0, 2], ['1.5 L', null, 0, 3], ['2.25 L', null, 0, 4],
      ],
      'Water Size': [
        ['S Mineral Water', null, 0, 0], ['L Mineral Water', null, 0, 1],
      ],
      'Pizza Add-On': [
        ['Extra Topping Cheese', null, 0, 0], ['Extra Topping Chicken', null, 0, 1], ['Cheese Slice', null, 0, 2],
      ],
      'Burger Add-ons': [
        ['Extra Cheese', 50, 0, 0], ['Extra Mayo', 30, 0, 1], ['Coleslaw', 40, 0, 2], ['Pickles', 20, 0, 3], ['Jalapeños', 50, 0, 4],
      ],
      'Balochi Sajji Portion': [
        ['Small', 650, 1, 0], ['Medium', 1100, 0, 1], ['Large', 2100, 0, 2],
      ],
      'Pasta Size': [
        ['Medium', null, 0, 0], ['Large', null, 0, 1],
      ],
      'Crispy Piece Quantity': [
        ['1 Piece', null, 0, 0], ['3 Piece', null, 0, 1], ['2 Piece', null, 0, 2],
      ],
    };

    for (const [gName, items] of Object.entries(vgItems)) {
      const gId = ids.variationGroups[gName];
      ids.variationItems[gName] = {};
      for (const [name, adj, isDef, order] of items) {
        const priceAdj = typeof adj === 'number' ? adj : 0;
        const [r] = await conn.query(
          'INSERT INTO variation_group_items (variation_group_id, name, price_adjustment, is_default, display_order) VALUES (?, ?, ?, ?, ?)',
          [gId, name, priceAdj, isDef || 0, order]
        );
        ids.variationItems[gName][name] = r.insertId;
      }
    }
    console.log('Inserted variation group items');

    // ========== 4. MENU ITEMS ==========
    const insertItem = async (catName, name, basePrice, order = 0, description = null, stationName = null) => {
      const station = stationName || categoryStation[catName] || 'Burgers & Grill';
      const stationId = ids.stations[station];
      if (!stationId) throw new Error(`Station not found: ${station} for ${name}`);
      const [r] = await conn.query(
        'INSERT INTO menu_items (category_id, station_id, name, base_price, display_order, description) VALUES (?, ?, ?, ?, ?, ?)',
        [ids.categories[catName], stationId, name, basePrice, order, description]
      );
      ids.menuItems[name] = r.insertId;
      return r.insertId;
    };

    const linkVariation = async (itemName, groupName, order = 0) => {
      await conn.query(
        'INSERT INTO menu_item_variation_groups (menu_item_id, variation_group_id, display_order) VALUES (?, ?, ?)',
        [ids.menuItems[itemName], ids.variationGroups[groupName], order]
      );
    };

    const updateVariationPrices = async (groupName, itemPrices) => {
      for (const [itemName, price] of Object.entries(itemPrices)) {
        const vgId = ids.variationGroups[groupName];
        const vgi = ids.variationItems[groupName];
        for (const [vName, vId] of Object.entries(vgi)) {
          const p = price[vName];
          if (p != null) await conn.query('UPDATE variation_group_items SET price_adjustment = ? WHERE id = ?', [p, vId]);
        }
      }
    };

    // --- BURGER ---
    await insertItem('Burger', 'Al Faisal Special Burger', 700, 0, 'Our signature burger with special sauce and fresh veggies');
    await insertItem('Burger', 'Tender Filled', 550, 0, 'Juicy tender chicken with cheese filling');
    await insertItem('Burger', 'Zinger Burger', 430, 0, 'Crispy fried chicken burger');
    await linkVariation('Zinger Burger', 'Burger Add-ons', 0);
    await insertItem('Burger', 'Tika Chatkhara', 350, 0, 'Spicy tikka flavored burger');
    await insertItem('Burger', 'Patty Burger', 350);
    await insertItem('Burger', 'Crispy Burger', 350);
    await insertItem('Burger', 'Grilled Burger', 550, 0, 'Grilled chicken with smoky flavor');
    await insertItem('Burger', 'Chicken Patty Burger', 350);

    // --- SANDWICH ---
    await insertItem('Sandwich', 'Grilled Chicken Sandwich', 550, 0, 'Grilled chicken with fresh vegetables');
    await insertItem('Sandwich', 'Club Sandwich', 500, 0, 'Triple-decker classic club');
    await insertItem('Sandwich', 'Mexican Sandwich', 680, 0, 'Spicy Mexican style with jalapeños');
    await insertItem('Sandwich', 'Kabab Stick', 480);
    await insertItem('Sandwich', 'Chicken Tika Sandwich', 450);

    // --- WINGS ---
    await insertItem('Wings', 'Hot Wings', 0);
    await linkVariation('Hot Wings', 'Wings Quantity');
    await conn.query('UPDATE variation_group_items SET price_adjustment = CASE name WHEN "5 PC" THEN 350 WHEN "10 PC" THEN 650 WHEN "4 PC" THEN 280 WHEN "12 PC" THEN 750 END WHERE variation_group_id = ?', [ids.variationGroups['Wings Quantity']]);

    await insertItem('Wings', 'Nuggets', 0);
    await linkVariation('Nuggets', 'Nuggets Quantity');
    await conn.query('UPDATE variation_group_items SET price_adjustment = CASE name WHEN "5 PC" THEN 300 WHEN "10 PC" THEN 600 WHEN "6 PC" THEN 350 END WHERE variation_group_id = ?', [ids.variationGroups['Nuggets Quantity']]);

    // --- PRATHA ROLL ---
    await insertItem('Pratha Roll', 'Chicken Pratha Roll', 350, 0, 'Soft pratha wrapped with chicken filling');
    await insertItem('Pratha Roll', 'Chicken Cheese Pratha Roll', 380, 0, 'Chicken and cheese in pratha');
    await insertItem('Pratha Roll', 'Zinger Pratha Roll', 430, 0, 'Crispy zinger with pratha');
    await insertItem('Pratha Roll', 'Kabab Pratha Roll', 400);
    await insertItem('Pratha Roll', 'Malai Boti Pratha Roll', 450);
    await insertItem('Pratha Roll', 'Pizza Pratha Roll', 500);
    await insertItem('Pratha Roll', 'Pratha Roll', 350); // generic for combos

    // --- SHAWARMA ---
    await insertItem('Shawarma', 'Platter Shawarma', 600, 0, 'Full platter with fries and sauces');
    await insertItem('Shawarma', 'Special Cheese Shawarma', 400, 0, 'Shawarma with melted cheese');
    await insertItem('Shawarma', 'Chicken Shawarma', 300, 0, 'Classic chicken shawarma wrap');

    // --- LAHORI DAIG'S ---
    const daigItems = [
      ['Chicken Biryani', 16500, '8x10 Serving'],
      ['Chicken Qorma', 17000, '10 KG'],
      ['Mutton Biryani', 34000, '8x10 Serving'],
      ['Mutton Qorma', 35000, '10 KG'],
      ['Chicken Haleem', 17000, null],
      ['Special Mutanjan', 16500, '10 KG'],
      ['Zafrani Zarda', 13000, '10 KG'],
    ];
    for (const [name, price, serving] of daigItems) {
      await insertItem('Lahori Special Daig\'s', name, price);
      if (serving) await linkVariation(name, 'Daig Serving');
    }

    // --- FRIES --- (each type has own prices)
    const createFriesGroup = async (name, prices) => {
      const vgName = `Fries ${name}`;
      await conn.query('INSERT INTO variation_groups (name, description, min_selections, max_selections) VALUES (?, ?, 1, 1)', [vgName, name]);
      const [vgR] = await conn.query('SELECT id FROM variation_groups WHERE name = ?', [vgName]);
      const vgId = vgR[0].id;
      const items = [['Regular', prices.R || 0], ['Medium', prices.M || 0], ['Large', prices.L || 0], ['Family', prices.F || 0]];
      for (let i = 0; i < items.length; i++) {
        await conn.query('INSERT INTO variation_group_items (variation_group_id, name, price_adjustment, display_order) VALUES (?, ?, ?, ?)', [vgId, items[i][0], items[i][1], i]);
      }
      return vgId;
    };
    const linkFries = async (itemName, vgId) => {
      await conn.query('INSERT INTO menu_item_variation_groups (menu_item_id, variation_group_id, display_order) VALUES (?, ?, 0)', [ids.menuItems[itemName], vgId]);
    };
    let vgLoaded = await createFriesGroup('Loaded', { M: 500, L: 600 });
    await insertItem('Fries', 'Loaded Fries', 0);
    await linkFries('Loaded Fries', vgLoaded);
    let vgMayo = await createFriesGroup('Mayo Garlic', { M: 330, L: 450 });
    await insertItem('Fries', 'Mayo Garlic Fries', 0);
    await linkFries('Mayo Garlic Fries', vgMayo);
    let vgMasala = await createFriesGroup('Masala', { M: 280, L: 380 });
    await insertItem('Fries', 'Masala Fries', 0);
    await linkFries('Masala Fries', vgMasala);
    let vgPlain = await createFriesGroup('Plain', { M: 260, L: 370 });
    await insertItem('Fries', 'Plain Fries', 0);
    await linkFries('Plain Fries', vgPlain);
    let vgFriesCombo = await createFriesGroup('Combo', { R: 100, M: 150, L: 200, F: 300 });
    await insertItem('Fries', 'Fries', 0);
    await linkFries('Fries', vgFriesCombo);

    // --- PASTA ---
    await insertItem('Pasta', 'Alfredo Pasta', 1000, 0, 'Creamy Alfredo sauce with pasta');
    await insertItem('Pasta', 'Penne Pasta', 1000, 0, 'Penne in rich tomato sauce');
    await insertItem('Pasta', 'Cheese Pasta', 1000, 0, 'Loaded with cheese');
    await insertItem('Pasta', 'Lasagna Pasta', 0);
    await linkVariation('Lasagna Pasta', 'Pasta Size');
    await conn.query('UPDATE variation_group_items SET price_adjustment = CASE name WHEN "Medium" THEN 530 WHEN "Large" THEN 750 END WHERE variation_group_id = ?', [ids.variationGroups['Pasta Size']]);

    await insertItem('Pasta', 'Macaroni Pasta', 0);
    await linkVariation('Macaroni Pasta', 'Pasta Size');
    await conn.query('UPDATE variation_group_items SET price_adjustment = CASE name WHEN "Medium" THEN 450 WHEN "Large" THEN 550 END WHERE variation_group_id = ?', [ids.variationGroups['Pasta Size']]);

    // --- BAR MENU ---
    await insertItem('Bar Menu', 'R Soft Drink', 90);
    await insertItem('Bar Menu', 'Soft Drink', 0);
    await linkVariation('Soft Drink', 'Soft Drink Size');
    await conn.query('UPDATE variation_group_items SET price_adjustment = CASE name WHEN "Regular" THEN 130 WHEN "500 ML" THEN 150 WHEN "1 L" THEN 200 WHEN "1.5 L" THEN 250 WHEN "2.25 L" THEN 350 END WHERE variation_group_id = ?', [ids.variationGroups['Soft Drink Size']]);

    await insertItem('Bar Menu', 'Diet Soft Drink', 130);
    await insertItem('Bar Menu', 'Fresh Lime', 200);
    await insertItem('Bar Menu', 'S Mineral Water', 90);
    await insertItem('Bar Menu', 'L Mineral Water', 140);
    await insertItem('Bar Menu', 'Mint Margarita', 300);
    await insertItem('Bar Menu', 'Peach Margarita', 300);
    await insertItem('Bar Menu', 'Strawberry Chiller', 300);
    await insertItem('Bar Menu', 'Blueberry Chiller', 350);

    // --- PIZZA --- (each pizza gets own size group for correct pricing)
    const pizzas = [
      ['Al Faisal Special Pizza', 750, 1250, 1900, 2500],
      ['Chicken Tikka Pizza', 650, 1100, 1550, 2300],
      ['Chicken Supreme Pizza', 680, 1150, 1600, 2350],
      ['Chicken BBQ Pizza', 680, 1150, 1600, 2350],
      ['Hot & Spicy Pizza', 650, 1100, 1550, 2300],
      ['Veggie Pizza', 500, 900, 1200, 2000],
      ['Crazy Stuffed Pizza', 700, 1200, 1800, 2400],
      ['Malai Boti Pizza', 700, 1200, 1800, 2400],
      ['Lasagna Pizza', 700, 1200, 1800, 2400],
      ['Kabab Stuffed Pizza', 700, 1200, 1800, 2400],
      ['Chicken Pepperoni Pizza', 680, 1150, 1600, 2300],
      ['Crown Crust Pizza', null, 1250, 1850, 2500],
      ['Behari Pizza', 700, 1200, 1800, 2400],
    ];
    for (const [name, s, m, l, xl] of pizzas) {
      const vgName = `Pizza Size ${name}`;
      await conn.query('INSERT INTO variation_groups (name, description, min_selections, max_selections) VALUES (?, ?, 1, 1)', [vgName, `Size for ${name}`]);
      const [vgR] = await conn.query('SELECT id FROM variation_groups WHERE name = ?', [vgName]);
      const vgId = vgR[0].id;
      await conn.query('INSERT INTO variation_group_items (variation_group_id, name, price_adjustment, display_order) VALUES (?,?,?,0),(?,?,?,1),(?,?,?,2),(?,?,?,3)', [vgId, 'Small', s || 0, vgId, 'Medium', m, vgId, 'Large', l, vgId, 'XL', xl]);
      await insertItem('Pizza', name, s || 0);
      await conn.query('INSERT INTO menu_item_variation_groups (menu_item_id, variation_group_id, display_order) VALUES (?, ?, 0)', [ids.menuItems[name], vgId]);
    }

    // --- CHICKEN FAJITA PIZZA (new product variant model: group items with full price + station, conditional toppings)
    await insertItem('Pizza', 'Chicken Fajita Pizza', 0);
    const pizzaStationId = ids.stations['Pizza'];
    await conn.query(
      'INSERT INTO variation_groups (name, description, min_selections, max_selections) VALUES (?, ?, 1, 1)',
      ['Fajita Pizza', 'Choose size - each option is a full product with station routing', 1, 1]
    );
    const [fgR] = await conn.query('SELECT id FROM variation_groups WHERE name = ?', ['Fajita Pizza']);
    const fajitaVgId = fgR[0].id;
    await conn.query(
      `INSERT INTO variation_group_items (variation_group_id, name, price_adjustment, base_price, station_id, is_product_item, is_default, display_order) VALUES
       (?, 'Fajita Pizza Small', 0, 580, ?, 1, 1, 0),
       (?, 'Fajita Pizza Medium', 0, 960, ?, 1, 0, 1),
       (?, 'Fajita Pizza Large', 0, 1500, ?, 1, 0, 2),
       (?, 'Fajita Pizza Family', 0, 1960, ?, 1, 0, 3)`,
      [fajitaVgId, pizzaStationId, fajitaVgId, pizzaStationId, fajitaVgId, pizzaStationId, fajitaVgId, pizzaStationId]
    );
    const [fajitaItems] = await conn.query('SELECT id, name FROM variation_group_items WHERE variation_group_id = ? ORDER BY display_order', [fajitaVgId]);
    const fajitaItemIds = fajitaItems.reduce((a, r) => ({ ...a, [r.name]: r.id }), {});
    await conn.query('INSERT INTO menu_item_variation_groups (menu_item_id, variation_group_id, display_order) VALUES (?, ?, 0)', [ids.menuItems['Chicken Fajita Pizza'], fajitaVgId]);

    // Topping groups per size (conditional - show when that size is selected)
    const toppingPrices = { Small: [30, 40, 25], Medium: [50, 60, 40], Large: [70, 90, 55], Family: [100, 120, 75] };
    const toppingNames = ['Extra Cheese', 'Extra Chicken', 'Cheese Slice'];
    for (const size of ['Small', 'Medium', 'Large', 'Family']) {
      const vgName = `Fajita Toppings ${size}`;
      await conn.query(
        'INSERT INTO variation_groups (name, description, min_selections, max_selections) VALUES (?, ?, 0, 3)',
        [`Fajita Toppings ${size}`, `Add-ons for Fajita Pizza ${size}`, 0, 3]
      );
      const [tgR] = await conn.query('SELECT id FROM variation_groups WHERE name = ?', [vgName]);
      const tgId = tgR[0].id;
      const prices = toppingPrices[size];
      for (let i = 0; i < toppingNames.length; i++) {
        await conn.query(
          'INSERT INTO variation_group_items (variation_group_id, name, price_adjustment, display_order) VALUES (?, ?, ?, ?)',
          [tgId, toppingNames[i], prices[i], i]
        );
      }
      const parentItemId = fajitaItemIds[`Fajita Pizza ${size}`];
      await conn.query(
        'INSERT INTO variation_group_dependencies (parent_variation_group_item_id, child_variation_group_id) VALUES (?, ?)',
        [parentItemId, tgId]
      );
    }

    await linkVariation('Chicken Tikka Pizza', 'Pizza Add-On', 1);
    await insertItem('Pizza', 'Extra Topping Cheese', 150, 0, 'Add extra cheese to any pizza');
    await insertItem('Pizza', 'Extra Topping Chicken', 150, 0, 'Add chicken topping');
    await insertItem('Pizza', 'Cheese Slice', 100);
    await insertItem('Pizza', 'Pizza', 650);
    await linkVariation('Pizza', 'Pizza Size', 0);
    await linkVariation('Pizza', 'Pizza Add-On', 1);

    // --- GRAVIES WITH RICE ---
    const gravies = [
      'Chicken Manchurian', 'Chicken Chilli Dry', 'Chicken Black Pepper', 'Chicken Garlic Sauce',
      'Chicken Shashlik', 'Chicken Schezwan', 'Chicken Mangolian',
    ];
    for (const name of gravies) {
      await insertItem('Gravies with Rice', name, 0);
      await linkVariation(name, 'Portion Half/Full 900-1500');
    }

    // --- RICE AND NOODLES ---
    await insertItem('Rice and Noodles', 'Mutton Palao', 0);
    await linkVariation('Mutton Palao', 'Portion Half/Full 600-900');

    await insertItem('Rice and Noodles', 'Beef Palao', 0);
    await linkVariation('Beef Palao', 'Portion Half/Full 550-850');

    await insertItem('Rice and Noodles', 'Chicken Malai Biryani', 550);
    await insertItem('Rice and Noodles', 'Chicken Tika Biryani', 550);
    await insertItem('Rice and Noodles', 'Chicken Biryani', 0);
    await linkVariation('Chicken Biryani', 'Portion Half/Full 600-900');

    await insertItem('Rice and Noodles', 'Sweet Rice / Mutanjan Rice', 0);
    await linkVariation('Sweet Rice / Mutanjan Rice', 'Portion Half/Full 450-600');

    await insertItem('Rice and Noodles', 'Egg Fried Rice', 550);
    await insertItem('Rice and Noodles', 'Masala Rice / Chicken Fried Rice', 600);
    await insertItem('Rice and Noodles', 'Vegetable Rice', 450);
    await insertItem('Rice and Noodles', 'Chicken Chowmein Noodles', 750);
    await insertItem('Rice and Noodles', 'Vegetable Chowmein Noodles', 650);
    await insertItem('Rice and Noodles', 'Biryani', 450); // for combos

    // --- CHAI SHAYE ---
    await insertItem('Chai Shaye', 'Karak Chai', 150);
    await insertItem('Chai Shaye', 'Kashmiri Chai', 180);
    await insertItem('Chai Shaye', 'Cardamom Tea', 150);
    await insertItem('Chai Shaye', 'Green Tea', 100);

    // --- BALOCHI SAJJI ---
    await insertItem('Balochi Sajji', 'Balochi Sajji', 0);
    await linkVariation('Balochi Sajji', 'Balochi Sajji Portion');

    // --- BBQ & GRILL ---
    const bbqItems = [
      ['Chicken Afghani Boti', 500, 940, 1750],
      ['Chicken Shish Touk Boti', 500, 940, 1750],
      ['Chicken Malai Boti', 500, 940, 1750],
      ['Chicken Tikka Boti', 500, 940, 1750],
      ['Chicken Kasturi Boti', 500, 940, 1750],
      ['Chicken Leg Piece', 430, 430, 860],
      ['Chicken Wings Dredged', 400, 750, 1400],
      ['Chicken Seekh Kebab', 450, 850, 1600],
      ['Chicken Afghani Kebab', 450, 850, 1600],
      ['Chicken Cheese Kebab', 450, 850, 1600],
      ['Chicken Gola Kebab', 450, 850, 1600],
      ['Chicken Reshmi Kebab', 450, 850, 1600],
      ['Beef Kebab', 500, 950, 1800],
      ['Special Mutton Chops', 1800, 3300, 3300],
      ['BBQ Platter (Mutton Chaanp)', 2500, 4500, 4500],
    ];
    for (const [name, small, half, full] of bbqItems) {
      await insertItem('BBQ & Grill', name, 0);
      await linkVariation(name, 'Portion BBQ');
      await conn.query('UPDATE variation_group_items SET price_adjustment = CASE name WHEN "Small" THEN ? WHEN "Half" THEN ? WHEN "Full" THEN ? END WHERE variation_group_id = ?', [small, half, full, ids.variationGroups['Portion BBQ']]);
    }

    // --- STARTERS ---
    await insertItem('Starters', 'Finger Fish', 450, 0, 'Crispy fried fish fingers');
    await insertItem('Starters', 'Honey Glazed Wings', 500, 0, 'Sweet and sticky honey glaze');
    await insertItem('Starters', 'Dhaka Chicken', 550);
    await insertItem('Starters', 'Fried Prawn', 600, 0, 'Crispy fried prawns');
    await insertItem('Starters', 'Spicy Chicken Wings', 450);
    await insertItem('Starters', 'Loaded Fries Starter', 500);

    // --- KIDS CORNER ---
    await insertItem('Kids Corner', 'Grilled Chicken Sandwich', 350);
    await insertItem('Kids Corner', 'Chicken Burger Kids', 300);
    await insertItem('Kids Corner', 'Nuggets Kids', 250);
    await insertItem('Kids Corner', 'Chicken Crispy Piece Kids', 280);

    // --- TANDOOR ---
    await insertItem('Tandoor', 'Naan / Khameri Roti', 50);
    await insertItem('Tandoor', 'Tandoori Roti', 40);
    await insertItem('Tandoor', 'Roghni Naan', 80);
    await insertItem('Tandoor', 'Kalwanji Naan', 80);
    await insertItem('Tandoor', 'Garlic Naan', 100);
    await insertItem('Tandoor', 'Achari Naan', 100);
    await insertItem('Tandoor', 'Chicken Naan', 150);

    // --- SALADS ---
    await insertItem('Salads', 'Russian Salad', 200);
    await insertItem('Salads', 'Macaroni Salad', 180);
    await insertItem('Salads', 'Fresh Salad', 150);
    await insertItem('Salads', 'Kachumer Salad', 120);
    await insertItem('Salads', 'Salad', 150); // for combos

    // --- SIDES ---
    await insertItem('Sides', 'Mint Raita', 80);
    await insertItem('Sides', 'Zeera Raita', 80);
    await insertItem('Sides', 'Raita', 80); // for combos

    // --- KARAHI'S ---
    const karahiChicken = [
      ['Chicken Karahi', 1300, 1900],
      ['Chicken Makhni Karahi', 1400, 2000],
      ['Chicken Black Pepper Karahi', 1400, 2000],
      ['Chicken White Karahi', 1400, 2000],
      ['Chicken Achari Karahi', 1400, 2000],
      ['Chicken Madrasi Karahi', 1400, 2000],
      ['Dunba Karahi', 1500, 2200],
    ];
    for (const [name] of karahiChicken) {
      await insertItem('Karahi\'s', name, 0);
      await linkVariation(name, 'Portion Half/Full 1300-1900');
    }
    await insertItem('Karahi\'s', 'Mutton Karahi', 0);
    await linkVariation('Mutton Karahi', 'Portion Half/Full 2200-3200');
    for (const name of ['Mutton Black Pepper', 'Mutton Green Chilli Lemon', 'Mutton White Karahi']) {
      await insertItem('Karahi\'s', name, 0);
      await linkVariation(name, 'Portion Half/Full 2300-3300');
    }
    await insertItem('Karahi\'s', 'Beef Karahi', 0);
    await linkVariation('Beef Karahi', 'Portion Half/Full 1800-2600');
    await insertItem('Karahi\'s', 'Beef Black Pepper Karahi', 0);
    await linkVariation('Beef Black Pepper Karahi', 'Portion Half/Full 1900-2700');

    // --- HANDI'S CHICKEN ---
    const handiItems = [
      'Chicken Al Faisal Special Handi', 'Chicken Mughlai Handi', 'Chicken Makhni Handi', 'Chicken Handi',
      'Chicken Green Chilli Handi', 'Chicken Green Chilli Lemon', 'Chicken Falafil Handi', 'Chicken Green Masala',
      'Chicken Achari Handi', 'Chicken Madrasi Handi', 'Chicken Rajastani Handi', 'Chicken Lahori Handi',
      'Chicken Haiderabadi Handi', 'Chicken Jaipuri Handi', 'Chicken Jalfrezi Handi', 'Chicken Tika Boti Masala',
      'Chicken Kabab Masala', 'Chicken Jinjer Handi',
    ];
    for (const name of handiItems) {
      await insertItem('Handi\'s Chicken', name, 0);
      await linkVariation(name, 'Portion Half/Full 1300-1900');
    }

    // --- CRISPY PIECE (for combos) ---
    await insertItem('Wings', 'Chicken Crispy Piece', 0);
    await linkVariation('Chicken Crispy Piece', 'Crispy Piece Quantity');
    await conn.query('UPDATE variation_group_items SET price_adjustment = CASE name WHEN "1 Piece" THEN 200 WHEN "3 Piece" THEN 550 WHEN "2 Piece" THEN 380 END WHERE variation_group_id = ?', [ids.variationGroups['Crispy Piece Quantity']]);

    // --- SHAMI KABAB (for combos) ---
    await insertItem('BBQ & Grill', 'Shami Kabab', 150);

    console.log('Inserted menu items');

    // ========== 5. COMBOS (Best Deals) ==========
    console.log('Inserting combos...');
    const comboCatId = ids.categories['Best Deals'];
    const combos = [
      ['Combo #1 Biryani', 750, 0],
      ['Combo #2 Zinger Burger', 600, 1],
      ['Combo #3 Tika Chatkhara', 1100, 2],
      ['Combo #4 Zinger Burger', 1200, 3],
      ['Combo #5 3 Type Burger', 1750, 4],
      ['Combo #6 Zinger Burger', 2500, 5],
      ['Combo #7 Burger', 3600, 6],
      ['Combo #8 Pizza', 750, 7],
      ['Combo #9 Pizza', 1400, 8],
      ['Combo #10 Pizza', 1800, 9],
      ['Combo #11 Pizza', 2250, 10],
      ['Combo #12 Pizza', 2700, 11],
      ['Combo #13 Pizza', 3350, 12],
      ['Combo #14 Pizza & Burger', 3500, 13],
      ['Combo #15 Pizza', 4350, 14],
      ['Combo #16 Pizza', 4700, 15],
      ['Combo #17 Burger', 4100, 16],
      ['Combo #18 Pizza', 2650, 17],
      ['Combo #19 Pizza & Burger', 2050, 18],
      ['Combo #20 Pratha Roll', 1100, 19],
      ['Combo #21 Pizza', 2300, 20],
      ['Combo #22 Pasta', 1250, 21],
      ['Legacy Biryani Combo (combo_items example)', 750, 22],
    ];

    const comboDescs = {
      'Combo #1 Biryani': 'Biryani with Shami Kabab, Raita, Salad and drink',
      'Combo #2 Zinger Burger': 'Zinger Burger with Fries and drink',
      'Combo #3 Tika Chatkhara': '2 Tika Chatkhara with Wings and drink',
      'Combo #8 Pizza': 'Pizza slice with drink',
      'Combo #14 Pizza & Burger': '3 Burgers + Pizza + Crispy + Drink. Mix and match burgers.',
      'Combo #22 Pasta': 'Pasta with drink',
      'Legacy Biryani Combo (combo_items example)': 'Fixed combo using combo_items table: Chicken Biryani + Shami Kabab + Raita + Soft Drink',
    };
    const comboStation = (comboName) => {
      if (/Pasta/.test(comboName)) return ids.stations['Pasta'];
      if (/Biryani/.test(comboName)) return ids.stations['Rice & Biryani'];
      if (/Pizza.*Burger|Burger.*Pizza/.test(comboName)) return ids.stations['Burgers & Grill'];
      if (/Burger|Roll/.test(comboName)) return ids.stations['Burgers & Grill'];
      if (/Pizza/.test(comboName)) return ids.stations['Pizza'];
      return ids.stations['Burgers & Grill'];
    };
    for (const [name, price, order] of combos) {
      const stationId = comboStation(name);
      await conn.query(
        'INSERT INTO combos (name, description, base_price, display_order, station_id) VALUES (?, ?, ?, ?, ?)',
        [name, comboDescs[name] || null, price, order, stationId]
      );
    }
    const [comboRows] = await conn.query('SELECT id, name FROM combos ORDER BY display_order');
    const comboIds = comboRows.reduce((a, r) => ({ ...a, [r.name]: r.id }), {});
    const mid = (n) => ids.menuItems[n] || 0;

    const insertComboGroup = async (comboId, name, order, minSel = 1, maxSel = 1) => {
      const [r] = await conn.query(
        'INSERT INTO combo_groups (combo_id, name, min_selections, max_selections, display_order) VALUES (?, ?, ?, ?, ?)',
        [comboId, name, minSel, maxSel, order]
      );
      return r.insertId;
    };
    const insertComboGroupItem = async (groupId, menuItemId, isDefault, priceAdj, order) => {
      if (!menuItemId) return;
      await conn.query(
        'INSERT INTO combo_group_items (combo_group_id, menu_item_id, is_default, price_adjustment, display_order) VALUES (?, ?, ?, ?, ?)',
        [groupId, menuItemId, isDefault ? 1 : 0, priceAdj || 0, order]
      );
    };

    const addComboWithGroups = async (comboName, groupsData) => {
      const cid = comboIds[comboName];
      if (!cid) return;
      for (let gi = 0; gi < groupsData.length; gi++) {
        const g = groupsData[gi];
        const gid = await insertComboGroup(cid, g.name, gi, g.min ?? 1, g.max ?? 1);
        for (let oi = 0; oi < g.items.length; oi++) {
          const [itemName, isDef, adj] = g.items[oi];
          await insertComboGroupItem(gid, mid(itemName), isDef, adj, oi);
        }
      }
    };

    const comboGroupsData = [
      { combo: 'Combo #1 Biryani', groups: [
        { name: 'Main', items: [['Biryani', 1, 0], ['Chicken Biryani', 0, 50]] },
        { name: 'Side', items: [['Shami Kabab', 1, 0]] },
        { name: 'Raita', items: [['Raita', 1, 0], ['Mint Raita', 0, 0], ['Zeera Raita', 0, 0]] },
        { name: 'Salad', items: [['Salad', 1, 0], ['Fresh Salad', 0, 0], ['Russian Salad', 0, 50]] },
        { name: 'Drink', items: [['Soft Drink', 1, 0], ['R Soft Drink', 0, 40], ['Fresh Lime', 0, 110]] },
      ]},
      { combo: 'Combo #2 Zinger Burger', groups: [
        { name: 'Burger', items: [['Zinger Burger', 1, 0], ['Chicken Patty Burger', 0, -80], ['Crispy Burger', 0, -80]] },
        { name: 'Fries', items: [['Fries', 1, 0], ['Loaded Fries', 0, 150], ['Plain Fries', 0, 0]] },
        { name: 'Drink', items: [['Soft Drink', 1, 0], ['R Soft Drink', 0, 40], ['Fresh Lime', 0, 110]] },
      ]},
      { combo: 'Combo #3 Tika Chatkhara', groups: [
        { name: 'Main', items: [['Tika Chatkhara', 1, 0]] },
        { name: 'Wings', items: [['Hot Wings', 1, 0], ['Nuggets', 0, 50]] },
        { name: 'Drink', items: [['Soft Drink', 1, 0], ['R Soft Drink', 0, 40]] },
      ]},
      { combo: 'Combo #4 Zinger Burger', groups: [
        { name: 'Burger', items: [['Zinger Burger', 1, 0]] },
        { name: 'Fries', items: [['Fries', 1, 0]] },
        { name: 'Wings', items: [['Hot Wings', 1, 0], ['Nuggets', 0, 50]] },
        { name: 'Drink', items: [['Soft Drink', 1, 0], ['R Soft Drink', 0, 40]] },
      ]},
      { combo: 'Combo #5 3 Type Burger', groups: [
        { name: 'Burger 1', items: [['Zinger Burger', 1, 0], ['Chicken Patty Burger', 0, -80]] },
        { name: 'Burger 2', items: [['Chicken Patty Burger', 1, 0], ['Crispy Burger', 0, 0]] },
        { name: 'Fries', items: [['Fries', 1, 0]] },
        { name: 'Drink', items: [['Soft Drink', 1, 0], ['R Soft Drink', 0, 40]] },
      ]},
      { combo: 'Combo #6 Zinger Burger', groups: [
        { name: 'Burger', items: [['Zinger Burger', 1, 0]] },
        { name: 'Fries', items: [['Fries', 1, 0]] },
        { name: 'Crispy', items: [['Chicken Crispy Piece', 1, 0]] },
        { name: 'Drink', items: [['Soft Drink', 1, 0], ['R Soft Drink', 0, 40]] },
      ]},
      { combo: 'Combo #7 Burger', groups: [
        { name: 'Burger', items: [['Zinger Burger', 1, 0]] },
        { name: 'Wings', items: [['Hot Wings', 1, 0], ['Nuggets', 0, 50]] },
        { name: 'Fries', items: [['Fries', 1, 0]] },
        { name: 'Drink', items: [['Soft Drink', 1, 0], ['R Soft Drink', 0, 40]] },
      ]},
      { combo: 'Combo #8 Pizza', groups: [
        { name: 'Pizza', items: [['Pizza', 1, 0], ['Al Faisal Special Pizza', 0, 100], ['Chicken Tikka Pizza', 0, 50]] },
        { name: 'Drink', items: [['Soft Drink', 1, 0], ['R Soft Drink', 0, 40]] },
      ]},
      { combo: 'Combo #9 Pizza', groups: [
        { name: 'Pizza', items: [['Pizza', 1, 0]] },
        { name: 'Drink', items: [['Soft Drink', 1, 0], ['R Soft Drink', 0, 40]] },
      ]},
      { combo: 'Combo #10 Pizza', groups: [
        { name: 'Pizza', items: [['Pizza', 1, 0]] },
        { name: 'Drink', items: [['Soft Drink', 1, 0]] },
      ]},
      { combo: 'Combo #11 Pizza', groups: [
        { name: 'Pizza', items: [['Pizza', 1, 0]] },
        { name: 'Drink', items: [['Soft Drink', 1, 0]] },
      ]},
      { combo: 'Combo #12 Pizza', groups: [
        { name: 'Pizza', items: [['Pizza', 1, 0]] },
        { name: 'Drink', items: [['Soft Drink', 1, 0]] },
      ]},
      { combo: 'Combo #13 Pizza', groups: [
        { name: 'Pizza', items: [['Pizza', 1, 0]] },
        { name: 'Drink', items: [['Soft Drink', 1, 0]] },
      ]},
      { combo: 'Combo #14 Pizza & Burger', groups: [
        { name: 'Burgers (choose 3)', min: 3, max: 3, items: [['Zinger Burger', 1, 0], ['Patty Burger', 0, -80], ['Crispy Burger', 0, -80], ['Chicken Patty Burger', 0, -80], ['Tika Chatkhara', 0, -80], ['Grilled Burger', 0, 120]] },
        { name: 'Pizza', items: [['Pizza', 1, 0]] },
        { name: 'Crispy', items: [['Chicken Crispy Piece', 1, 0]] },
        { name: 'Drink', items: [['Soft Drink', 1, 0], ['R Soft Drink', 0, 40]] },
      ]},
      { combo: 'Combo #15 Pizza', groups: [
        { name: 'Pizza', items: [['Pizza', 1, 0]] },
        { name: 'Nuggets', items: [['Nuggets', 1, 0], ['Hot Wings', 0, 50]] },
        { name: 'Wings', items: [['Hot Wings', 1, 0]] },
        { name: 'Drink', items: [['Soft Drink', 1, 0], ['R Soft Drink', 0, 40]] },
      ]},
      { combo: 'Combo #16 Pizza', groups: [
        { name: 'Pizza', items: [['Pizza', 1, 0]] },
        { name: 'Drink', items: [['Soft Drink', 1, 0]] },
      ]},
      { combo: 'Combo #17 Burger', groups: [
        { name: 'Burger', items: [['Zinger Burger', 1, 0]] },
        { name: 'Fries', items: [['Fries', 1, 0]] },
        { name: 'Drink', items: [['Soft Drink', 1, 0], ['R Soft Drink', 0, 40]] },
      ]},
      { combo: 'Combo #18 Pizza', groups: [
        { name: 'Pizza', items: [['Pizza', 1, 0]] },
        { name: 'Crispy', items: [['Chicken Crispy Piece', 1, 0]] },
        { name: 'Drink', items: [['Soft Drink', 1, 0]] },
      ]},
      { combo: 'Combo #19 Pizza & Burger', groups: [
        { name: 'Burger', items: [['Zinger Burger', 1, 0]] },
        { name: 'Pizza', items: [['Pizza', 1, 0]] },
        { name: 'Drink', items: [['Soft Drink', 1, 0], ['R Soft Drink', 0, 40]] },
      ]},
      { combo: 'Combo #20 Pratha Roll', groups: [
        { name: 'Roll', items: [['Pratha Roll', 1, 0], ['Chicken Pratha Roll', 0, 0], ['Zinger Pratha Roll', 0, 80]] },
        { name: 'Nuggets', items: [['Nuggets', 1, 0], ['Hot Wings', 0, 50]] },
        { name: 'Drink', items: [['Soft Drink', 1, 0], ['R Soft Drink', 0, 40]] },
      ]},
      { combo: 'Combo #21 Pizza', groups: [
        { name: 'Pizza', items: [['Pizza', 1, 0]] },
        { name: 'Wings', items: [['Hot Wings', 1, 0], ['Nuggets', 0, 50]] },
        { name: 'Drink', items: [['Soft Drink', 1, 0], ['R Soft Drink', 0, 40]] },
      ]},
      { combo: 'Combo #22 Pasta', groups: [
        { name: 'Pasta', items: [['Lasagna Pasta', 1, 0], ['Macaroni Pasta', 0, -80], ['Alfredo Pasta', 0, 250]] },
        { name: 'Drink', items: [['Soft Drink', 1, 0], ['R Soft Drink', 0, 40], ['Fresh Lime', 0, 110]] },
      ]},
    ];

    for (const { combo, groups } of comboGroupsData) {
      await addComboWithGroups(combo, groups);
    }

    // Legacy combo using combo_items (no combo_groups) — example for combo_items table
    const legacyComboId = comboIds['Legacy Biryani Combo (combo_items example)'];
    if (legacyComboId) {
      const legacyItems = [
        ['Chicken Biryani', 1, 1, 0],
        ['Shami Kabab', 1, 1, 1],
        ['Raita', 1, 1, 2],
        ['Soft Drink', 1, 1, 3],
      ];
      for (const [itemName, minQty, maxQty, displayOrder] of legacyItems) {
        const mId = mid(itemName);
        if (mId) {
          await conn.query(
            'INSERT INTO combo_items (combo_id, menu_item_id, min_quantity, max_quantity, display_order) VALUES (?, ?, ?, ?, ?)',
            [legacyComboId, mId, minQty, maxQty, displayOrder]
          );
        }
      }
      console.log('Inserted legacy combo (combo_items)');
    }

    // combo_variation_rules examples (schema ready; API does not use these yet)
    try {
      const c8Id = comboIds['Combo #8 Pizza'];
      const pizzaItemId = mid('Pizza');
      const pizzaSizeVgId = ids.variationGroups['Pizza Size'];
      const pizzaAddOnVgId = ids.variationGroups['Pizza Add-On'];
      if (c8Id && pizzaItemId && pizzaSizeVgId && pizzaAddOnVgId) {
        await conn.query(
          `INSERT INTO combo_variation_rules (combo_id, menu_item_id, variation_group_id, is_allowed) VALUES
           (?, ?, ?, 1), (?, ?, ?, 0)`,
          [c8Id, pizzaItemId, pizzaSizeVgId, c8Id, pizzaItemId, pizzaAddOnVgId]
        );
        console.log('Inserted combo_variation_rules example (Pizza Size allowed, Pizza Add-On disallowed for Combo #8)');
      }
    } catch (e) {
      console.warn('combo_variation_rules seed skip:', e.message);
    }

    console.log('Inserted combos and combo groups');

    // ========== 6. COMBO RULES (upsell: add Drink + Side when adding item) ==========
    const addComboRule = async (name, desc, triggerType, triggerId, comboBasePrice, groups) => {
      const [crR] = await conn.query(
        `INSERT INTO combo_rules (name, description, trigger_type, trigger_id, combo_discount_amount, combo_base_price, display_order) VALUES (?, ?, ?, ?, 0, ?, 0)`,
        [name, desc, triggerType, triggerId, comboBasePrice ?? 0]
      );
      const crId = crR.insertId;
      for (let gi = 0; gi < groups.length; gi++) {
        const [gName, gMin, gMax, gItems] = groups[gi];
        const [crgR] = await conn.query(
          `INSERT INTO combo_rule_groups (combo_rule_id, name, min_selections, max_selections, display_order) VALUES (?, ?, ?, ?, ?)`,
          [crId, gName, gMin || 1, gMax || 1, gi]
        );
        const gid = crgR.insertId;
        for (let ii = 0; ii < gItems.length; ii++) {
          const [itemName, isDef, adj] = gItems[ii];
          await conn.query(
            `INSERT INTO combo_rule_group_items (combo_rule_group_id, menu_item_id, is_default, price_adjustment, display_order) VALUES (?, ?, ?, ?, ?)`,
            [gid, mid(itemName), isDef ? 1 : 0, adj || 0, ii]
          );
        }
      }
    };
    try {
      await addComboRule('Pizza Combo Offer', 'Add 1 Drink + 1 Side — Rs 150 base. Upgrades add extra.', 'category', ids.categories['Pizza'], 150, [
        ['Drink', 1, 1, [['Soft Drink', 1, 0], ['R Soft Drink', 0, 40], ['Fresh Lime', 0, 310]]],
        ['Side', 1, 1, [['Fries', 1, 0], ['Loaded Fries', 0, 80], ['Plain Fries', 0, 0]]],
      ]);
      await addComboRule('Burger Combo Offer', 'Add 1 Drink + 1 Side', 'category', ids.categories['Burger'], 100, [
        ['Drink', 1, 1, [['Soft Drink', 1, 0], ['R Soft Drink', 0, 40]]],
        ['Side', 1, 1, [['Fries', 1, 0], ['Plain Fries', 0, 0]]],
      ]);
      await addComboRule('Pasta Combo Offer', 'Add 1 Drink', 'category', ids.categories['Pasta'], 80, [
        ['Drink', 1, 1, [['Soft Drink', 1, 0], ['R Soft Drink', 0, 40], ['Fresh Lime', 0, 110]]],
      ]);
      console.log('Inserted combo rules');
    } catch (e) {
      console.warn('Combo rules seed skip:', e.message);
    }

    const [counts] = await conn.query(`
      SELECT (SELECT COUNT(*) FROM categories) as cats,
             (SELECT COUNT(*) FROM menu_items) as items,
             (SELECT COUNT(*) FROM variation_groups) as vg,
             (SELECT COUNT(*) FROM combos) as combos
    `);
    console.log('\n✅ Seed complete:', counts[0]);
  } catch (err) {
    console.error('Seed failed:', err);
    throw err;
  } finally {
    await conn.end();
  }
}

run().then(() => process.exit(0)).catch(() => process.exit(1));
