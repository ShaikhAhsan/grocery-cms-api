const path = require('path');
const fs = require('fs');
const os = require('os');
const { Sequelize } = require('sequelize');

const apiRoot = path.join(__dirname, '..');

require('dotenv').config({
  path: path.join(apiRoot, '.env'),
  override: process.env.DOTENV_NO_OVERRIDE !== '1',
});

function readDbHostFromEnvFiles() {
  const candidates = [
    path.join(apiRoot, '.env'),
    path.join(process.cwd(), '.env'),
  ];
  for (const fp of candidates) {
    try {
      if (!fs.existsSync(fp)) continue;
      const text = fs.readFileSync(fp, 'utf8');
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const m = /^DB_HOST\s*=\s*(.*)$/.exec(trimmed);
        if (!m) continue;
        let v = m[1].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        v = v.trim();
        if (v) return v;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

function isPoisonedMysqlHost(dbHost) {
  const h = (dbHost || '').toLowerCase().trim();
  if (!h) return true;
  const loopback = new Set(['localhost', '127.0.0.1', '127.0.1.1', '::1']);
  const machine = os.hostname().toLowerCase();
  const machineShort = machine.split('.')[0];
  return loopback.has(h) || h === machine || h === machineShort;
}

/**
 * Coolify/Docker set DB_HOST=localhost (or the container name) before Node starts; that resolves to
 * 127.0.1.1 on many Linux images. Workbench uses the real MySQL hostname — we recover via file / fallbacks.
 */
function resolveMysqlHost() {
  const forced = (process.env.DB_FORCE_HOST || '').trim();
  if (forced) return forced;

  // Name Coolify will not inject — set this in Coolify UI to your Hostinger MySQL host if DB stays broken
  const grocery = (process.env.GROCERY_MYSQL_HOST || '').trim();
  if (grocery) return grocery;

  const useLocalMysql =
    process.env.DB_USE_LOCAL_MYSQL === '1' || process.env.DB_USE_LOCAL_MYSQL === 'true';

  let dbHost = (process.env.DB_HOST || '').trim();
  const remoteFallback = (process.env.DB_REMOTE_HOST || '').trim();
  const emergency = (process.env.DB_DEFAULT_REMOTE_HOST || 'srv1149167.hstgr.cloud').trim();

  if (useLocalMysql) {
    return dbHost || 'localhost';
  }

  if (isPoisonedMysqlHost(dbHost)) {
    const fromFile = readDbHostFromEnvFiles();
    if (fromFile && !isPoisonedMysqlHost(fromFile)) {
      console.warn(
        `[DB] process.env.DB_HOST="${dbHost}" is loopback/this machine — using DB_HOST from .env file on disk: ${fromFile}`
      );
      return fromFile;
    }
    if (remoteFallback) {
      console.warn(
        `[DB] process.env.DB_HOST="${dbHost}" is poisoned — using DB_REMOTE_HOST=${remoteFallback}`
      );
      return remoteFallback;
    }
    console.warn(
      `[DB] process.env.DB_HOST="${dbHost}" is poisoned and no good .env file line — using ${emergency}. Set GROCERY_MYSQL_HOST or DB_REMOTE_HOST in Coolify.`
    );
    return emergency;
  }

  if (!dbHost) {
    const fromFile = readDbHostFromEnvFiles();
    if (fromFile && !isPoisonedMysqlHost(fromFile)) return fromFile;
    if (remoteFallback) return remoteFallback;
    return emergency;
  }

  return dbHost;
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
