const path = require('path');
const fs = require('fs');
const os = require('os');
const dns = require('dns');

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

function isLoopbackIp(ip) {
  if (!ip || typeof ip !== 'string') return true;
  return ip.startsWith('127.') || ip === '0.0.0.0';
}

function publicDnsServers() {
  const raw = process.env.DB_DNS_SERVERS || '8.8.8.8,1.1.1.1';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
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

function pickConnectIp(ips) {
  if (!ips || !ips.length) return null;
  const ok = ips.find((ip) => !isLoopbackIp(ip));
  return ok || null;
}

async function resolve4WithServers(hostname, usePublicDns) {
  const { promises } = dns;
  if (usePublicDns) {
    const r = new promises.Resolver();
    r.setServers(publicDnsServers());
    return r.resolve4(hostname);
  }
  return promises.resolve4(hostname);
}

async function resolveMysqlConnectHost() {
  const logical = resolveMysqlHost();

  const skipDns =
    process.env.DB_SKIP_DNS_RESOLVE === '1' ||
    process.env.DB_USE_LOCAL_MYSQL === '1' ||
    process.env.DB_USE_LOCAL_MYSQL === 'true' ||
    isIpv4Literal(logical);

  if (skipDns) return logical;

  for (const usePublic of [false, true]) {
    try {
      const ips = await resolve4WithServers(logical, usePublic);
      const ip = pickConnectIp(ips);
      if (ip) {
        console.log(
          `[DB] Using ${ip} for MySQL (DNS${usePublic ? ' via DB_DNS_SERVERS' : ''} for "${logical}"; avoids /etc/hosts → 127.0.1.1)`
        );
        return ip;
      }
      if (ips && ips.length) {
        console.warn(`[DB] DNS returned only loopback for "${logical}", retrying with public DNS…`);
      }
    } catch (e) {
      if (!usePublic) {
        console.warn(`[DB] dns.resolve4("${logical}") failed, retrying public DNS:`, e.message);
      } else {
        console.warn(`[DB] dns.resolve4("${logical}") failed, using hostname:`, e.message);
      }
    }
  }

  return logical;
}

/**
 * Same as async resolve but blocking — needed if the process entrypoint is app.js (skips server.js).
 */
function resolveMysqlConnectHostSync() {
  const logical = resolveMysqlHost();

  const skipDns =
    process.env.DB_SKIP_DNS_RESOLVE === '1' ||
    process.env.DB_USE_LOCAL_MYSQL === '1' ||
    process.env.DB_USE_LOCAL_MYSQL === 'true' ||
    isIpv4Literal(logical);

  if (skipDns) return logical;

  const { execFileSync } = require('child_process');
  const hostJson = JSON.stringify(logical);
  const serversJson = JSON.stringify(publicDnsServers());

  const scriptSystem = `
    require('dns').promises.resolve4(${hostJson})
      .then((ips) => {
        const ok = (ips || []).find((i) => !i.startsWith('127.'));
        console.log(ok || '');
      })
      .catch(() => console.log(''));
  `;
  const scriptPublic = `
    const r = new (require('dns').promises.Resolver)();
    r.setServers(${serversJson});
    r.resolve4(${hostJson})
      .then((ips) => {
        const ok = (ips || []).find((i) => !i.startsWith('127.'));
        console.log(ok || '');
      })
      .catch(() => console.log(''));
  `;

  for (let attempt = 0; attempt < 2; attempt++) {
    const script = attempt === 0 ? scriptSystem : scriptPublic;
    try {
      const out = execFileSync(process.execPath, ['-e', script], {
        encoding: 'utf8',
        timeout: 20000,
        maxBuffer: 64,
      }).trim();
      if (/^(\d{1,3}\.){3}\d{1,3}$/.test(out) && !isLoopbackIp(out)) {
        console.log(
          `[DB] (sync) Using ${out} for MySQL — DNS${attempt === 1 ? ' (public resolvers)' : ''} for "${logical}"`
        );
        return out;
      }
    } catch (e) {
      console.warn('[DB] sync DNS attempt failed:', e.message);
    }
  }

  return logical;
}

module.exports = {
  resolveMysqlHost,
  resolveMysqlConnectHost,
  resolveMysqlConnectHostSync,
  isIpv4Literal,
  isPoisonedMysqlHost,
  readDbHostFromEnvFiles,
};
