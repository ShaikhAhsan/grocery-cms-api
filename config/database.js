const path = require('path');
const os = require('os');
const { Sequelize } = require('sequelize');

require('dotenv').config({
  path: path.join(__dirname, '..', '.env'),
  override: process.env.DOTENV_NO_OVERRIDE !== '1',
});

/**
 * Coolify and other platforms inject DB_HOST=localhost or the container hostname; on Linux that
 * often resolves to 127.0.1.1 (see /etc/hosts). Workbench uses your real MySQL hostname — match that here.
 */
function resolveMysqlHost() {
  const forced = (process.env.DB_FORCE_HOST || '').trim();
  if (forced) return forced;

  const useLocalMysql =
    process.env.DB_USE_LOCAL_MYSQL === '1' || process.env.DB_USE_LOCAL_MYSQL === 'true';

  let dbHost = (process.env.DB_HOST || '').trim();
  const remoteFallback = (process.env.DB_REMOTE_HOST || '').trim();
  const h = dbHost.toLowerCase();
  const loopback = new Set(['localhost', '127.0.0.1', '127.0.1.1', '::1']);
  const machine = os.hostname().toLowerCase();
  const machineShort = machine.split('.')[0];

  if (!useLocalMysql && (loopback.has(h) || h === machine || h === machineShort)) {
    if (remoteFallback) {
      console.warn(
        `[DB] DB_HOST="${dbHost}" is loopback or this server hostname; using DB_REMOTE_HOST=${remoteFallback}`
      );
      return remoteFallback;
    }
    const emergency = (process.env.DB_DEFAULT_REMOTE_HOST || 'srv1149167.hstgr.cloud').trim();
    console.warn(
      `[DB] DB_HOST="${dbHost}" is loopback or this machine — using DB_DEFAULT_REMOTE_HOST/${emergency}. Set DB_REMOTE_HOST in Coolify if your MySQL host differs.`
    );
    return emergency;
  }

  if (!dbHost && remoteFallback) return remoteFallback;
  return dbHost || remoteFallback || 'srv1149167.hstgr.cloud';
}

const dbHost = resolveMysqlHost();
const dbPort = parseInt(process.env.DB_PORT || '3306', 10);
const dbSsl = process.env.DB_SSL === 'true';

console.log(`[DB] Sequelize host=${dbHost} port=${dbPort} ssl=${dbSsl}`);

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
      ssl: dbSsl ? { rejectUnauthorized: false } : false,
    },
    dialectModule: require('mysql2'),
  }
);

module.exports = { sequelize };
