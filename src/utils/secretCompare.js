const crypto = require('crypto');

/**
 * Constant-time string compare for secrets (UTF-8).
 * @param {string|null|undefined} a
 * @param {string|null|undefined} b
 */
function constantTimeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) {
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Bearer token or X-Robot-Fleet-Secret header.
 * @param {import('express').Request} req
 * @returns {string|null}
 */
function readFleetCredential(req) {
  const h = req.headers['x-robot-fleet-secret'];
  if (typeof h === 'string' && h.trim().length > 0) {
    return h.trim();
  }
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  return null;
}

module.exports = { constantTimeCompare, readFleetCredential };
