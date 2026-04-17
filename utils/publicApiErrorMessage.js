/**
 * Human-readable API error text. Hides host/port/socket details for DB connection failures.
 */

function connectionErrorCode(err) {
  if (!err) return '';
  return String(err.parent?.code || err.original?.code || err.code || '').toUpperCase();
}

function isLikelyDatabaseConnectionError(err) {
  if (!err) return false;
  const name = String(err.name || '');
  if (/SequelizeConnection|SequelizeTimeout|SequelizeHostNotFound|SequelizeAccessDenied/i.test(name)) {
    return true;
  }
  const code = connectionErrorCode(err);
  if (
    ['ECONNREFUSED', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET'].includes(
      code
    )
  ) {
    return true;
  }
  const msg = String(err.message || '');
  if (/^connect\s+E/i.test(msg) || /getaddrinfo|SequelizeConnectionError|ECONNREFUSED|ETIMEDOUT|ENETUNREACH/i.test(msg)) {
    return true;
  }
  return false;
}

/**
 * @param {Error} err
 * @param {string} [fallback]
 * @returns {string}
 */
function publicApiErrorMessage(err, fallback = 'Something went wrong. Please try again.') {
  if (!err) return fallback;

  if (isLikelyDatabaseConnectionError(err)) {
    const code = connectionErrorCode(err);
    const msg = String(err.message || '');

    if (code === 'ECONNREFUSED' || /^connect\s+ECONNREFUSED/i.test(msg)) {
      return 'Could not connect to the database (connection refused). Check that the database service is running and reachable.';
    }
    if (code === 'ETIMEDOUT' || /ETIMEDOUT|timed out/i.test(msg)) {
      return 'The database connection timed out. Check your network, firewall, and that the database server is available.';
    }
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || /getaddrinfo|ENOTFOUND/i.test(msg)) {
      return 'The database address could not be resolved. Verify the database hostname in your configuration.';
    }
    if (code === 'ENETUNREACH' || code === 'EHOSTUNREACH' || /ENETUNREACH|no route to host|EHOSTUNREACH/i.test(msg)) {
      return 'Cannot reach the database server from this network. Check your internet connection, VPN, or firewall, then try again.';
    }
    if (code === 'ECONNRESET' || /ECONNRESET|connection.*closed|read ECONNRESET/i.test(msg)) {
      return 'The database connection was interrupted. Please try again.';
    }
    if (/ER_ACCESS_DENIED|Access denied for user/i.test(msg)) {
      return 'Database sign-in failed. Check the database username and password in the server configuration.';
    }
    return 'Could not connect to the database. If the problem continues, contact your administrator.';
  }

  const raw = String(err.message || '').trim();
  return raw || fallback;
}

module.exports = { publicApiErrorMessage, isLikelyDatabaseConnectionError };
