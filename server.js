/**
 * Entry: resolve MySQL hostname via DNS (dns.resolve4) before loading the app.
 * On Hostinger + Coolify the same FQDN as MySQL is often in /etc/hosts -> 127.0.1.1; getaddrinfo
 * then hits loopback. Workbench uses public DNS. Setting DB_RESOLVED_IPV4 avoids that.
 *
 * Set DB_SKIP_DNS_RESOLVE=1 to disable (e.g. local MySQL hostname only in hosts).
 */
const path = require('path');

require('dotenv').config({
  path: path.join(__dirname, '.env'),
  override: process.env.DOTENV_NO_OVERRIDE !== '1',
});

const { resolveMysqlConnectHost } = require('./config/mysqlHost');

(async () => {
  try {
    if (!process.env.DB_RESOLVED_IPV4) {
      process.env.DB_RESOLVED_IPV4 = await resolveMysqlConnectHost();
    }
  } catch (e) {
    console.error('[DB] bootstrap failed:', e);
    process.exit(1);
  }

  require('./app');
})();
