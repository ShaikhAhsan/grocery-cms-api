const path = require('path');
const fs = require('fs');
const os = require('os');

const apiRoot = path.join(__dirname, '..');

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

function isIpv4Literal(host) {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test((host || '').trim());
}

/**
 * Logical MySQL hostname from env / file (before DNS). Same Hostinger hostname as the VPS often
 * appears in /etc/hosts as 127.0.1.1 — use resolveMysqlConnectHost() for the actual TCP target.
 */
function resolveMysqlHost() {
  const forced = (process.env.DB_FORCE_HOST || '').trim();
  if (forced) return forced;

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

/** TCP host for mysql2: IPv4 from public DNS when possible (skips /etc/hosts). */
async function resolveMysqlConnectHost() {
  const logical = resolveMysqlHost();

  const skipDns =
    process.env.DB_SKIP_DNS_RESOLVE === '1' ||
    process.env.DB_USE_LOCAL_MYSQL === '1' ||
    process.env.DB_USE_LOCAL_MYSQL === 'true' ||
    isIpv4Literal(logical);

  if (skipDns) return logical;

  try {
    const dns = require('dns').promises;
    const ips = await dns.resolve4(logical);
    if (ips && ips[0]) {
      console.log(
        `[DB] Using ${ips[0]} for MySQL (DNS A record for "${logical}"; avoids /etc/hosts → 127.0.1.1 on same VPS as Hostinger)`
      );
      return ips[0];
    }
  } catch (e) {
    console.warn(`[DB] dns.resolve4("${logical}") failed, using hostname:`, e.message);
  }

  return logical;
}

module.exports = {
  resolveMysqlHost,
  resolveMysqlConnectHost,
  isIpv4Literal,
  isPoisonedMysqlHost,
  readDbHostFromEnvFiles,
};
