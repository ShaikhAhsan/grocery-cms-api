const path = require('path');
const { Sequelize } = require('sequelize');
const { resolveMysqlHost } = require('./mysqlHost');

const apiRoot = path.join(__dirname, '..');

require('dotenv').config({
  path: path.join(apiRoot, '.env'),
  override: process.env.DOTENV_NO_OVERRIDE !== '1',
});

const logicalHost = process.env.DB_LOGICAL_MYSQL_HOST || resolveMysqlHost();
const dbHost = process.env.DB_RESOLVED_IPV4 || logicalHost;
const dbPort = parseInt(process.env.DB_PORT || '3306', 10);
const dbSsl = process.env.DB_SSL === 'true';

if (process.env.DB_RESOLVED_IPV4 && process.env.DB_RESOLVED_IPV4 !== logicalHost) {
  console.log(
    `[DB] Sequelize host=${dbHost} port=${dbPort} ssl=${dbSsl} (TLS servername=${logicalHost})`
  );
} else {
  console.log(`[DB] Sequelize host=${dbHost} port=${dbPort} ssl=${dbSsl}`);
}

const sslOptions = dbSsl
  ? { rejectUnauthorized: false, servername: logicalHost }
  : false;

const sequelize = new Sequelize(
  process.env.DB_NAME || 'grocery_store_db',
  process.env.DB_USER || 'grocery_store_api_user',
  process.env.DB_PASSWORD || '',
  {
    host: dbHost,
    port: dbPort,
    dialect: 'mysql',
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    pool: { max: 10, min: 0, acquire: 30000, idle: 10000 },
    define: { timestamps: true, underscored: true, freezeTableName: true },
    timezone: '+05:00',
    dialectOptions: {
      ssl: sslOptions,
    },
    dialectModule: require('mysql2'),
  }
);

module.exports = { sequelize };
