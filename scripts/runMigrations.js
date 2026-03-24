#!/usr/bin/env node
/**
 * Run database migrations
 * Usage: node scripts/runMigrations.js
 */
const path = require('path');
require('dotenv').config({
  path: path.join(__dirname, '..', '.env'),
  override: process.env.DOTENV_NO_OVERRIDE !== '1',
});

const mysql = require('mysql2/promise');
const fs = require('fs');
const { resolveMysqlConnectHost } = require('../config/mysqlHost');

async function buildDbConfig() {
  const host = await resolveMysqlConnectHost();
  return {
    host,
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'grocery_store_api_user',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'grocery_store_db',
    multipleStatements: true,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  };
}

async function runMigrations() {
  const dbConfig = await buildDbConfig();
  console.log(`\n🔌 Connecting to ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}...`);

  const connection = await mysql.createConnection(dbConfig);

  try {
    const migrationsDir = path.join(__dirname, '../migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      console.log('No migration files found.');
      return;
    }

    // Create migrations tracking table if not exists
    await connection.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        filename VARCHAR(255) NOT NULL UNIQUE,
        executed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const [executed] = await connection.query(
      'SELECT filename FROM _migrations'
    );
    const executedSet = new Set(executed.map((r) => r.filename));

    for (const file of files) {
      if (executedSet.has(file)) {
        console.log(`⏭️  Skipping (already run): ${file}`);
        continue;
      }

      const sqlPath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(sqlPath, 'utf8');

      console.log(`\n🔄 Running: ${file}`);
      await connection.query(sql);
      await connection.query('INSERT INTO _migrations (filename) VALUES (?)', [file]);
      console.log(`✅ Completed: ${file}`);
    }

    // List all tables
    const [tables] = await connection.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME NOT LIKE '_%'
       ORDER BY TABLE_NAME`,
      [dbConfig.database]
    );

    console.log('\n📊 Tables in database:');
    tables.forEach((t) => console.log(`   ✓ ${t.TABLE_NAME}`));
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    throw error;
  } finally {
    await connection.end();
    console.log('\n🔌 Connection closed.\n');
  }
}

runMigrations()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
