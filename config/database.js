const { Sequelize } = require('sequelize');
require('dotenv').config();

let dbHost = process.env.DB_HOST || 'srv1149167.hstgr.cloud';
if (process.env.DB_FORCE_HOST) dbHost = process.env.DB_FORCE_HOST;

const sequelize = new Sequelize(
  process.env.DB_NAME || 'grocery_store_db',
  process.env.DB_USER || 'grocery_store_api_user',
  process.env.DB_PASSWORD || '',
  {
    host: dbHost,
    port: parseInt(process.env.DB_PORT || '3306', 10),
    dialect: 'mysql',
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    pool: { max: 10, min: 0, acquire: 30000, idle: 10000 },
    define: { timestamps: true, underscored: true, freezeTableName: true },
    timezone: '+05:00',
    dialectOptions: {
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
    },
    dialectModule: require('mysql2')
  }
);

module.exports = { sequelize };
