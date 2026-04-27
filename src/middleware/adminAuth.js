const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const { jwtExpiresToMs, resolveCookieSecure } = require('./teleopSession');

const ADMIN_JWT_ROLE = 'admin';

function parseBasicAuth(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return null;
  }
  const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
  const colon = decoded.indexOf(':');
  if (colon === -1) {
    return { username: decoded, password: '' };
  }
  return {
    username: decoded.slice(0, colon),
    password: decoded.slice(colon + 1),
  };
}

function credentialsMatch(adminConfig, username, password) {
  const u = String(username ?? '').trim();
  const p = String(password ?? '').trim();
  const eu = String(adminConfig.username ?? '').trim();
  const ep = String(adminConfig.password ?? '').trim();
  return u === eu && p === ep;
}

function hasValidBasicAuth(req, adminConfig) {
  const parsed = parseBasicAuth(req);
  if (!parsed) {
    return false;
  }
  return credentialsMatch(adminConfig, parsed.username, parsed.password);
}

function readAdminTokenFromCookie(req, cookieName) {
  if (req.cookies && req.cookies[cookieName]) {
    return req.cookies[cookieName];
  }
  return null;
}

function verifyAdminSessionToken(token, adminConfig) {
  if (!token || !adminConfig.sessionSecret) {
    return false;
  }
  try {
    const payload = jwt.verify(token, adminConfig.sessionSecret);
    return payload.role === ADMIN_JWT_ROLE && payload.sub === 'admin';
  } catch {
    return false;
  }
}

function hasValidSessionCookie(req, adminConfig) {
  const token = readAdminTokenFromCookie(req, adminConfig.cookieName);
  return verifyAdminSessionToken(token, adminConfig);
}

function adminCookieBaseOptions(req, adminConfig) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: resolveCookieSecure(req, { cookieSecureMode: adminConfig.cookieSecureMode }),
    path: '/',
  };
}

function signAdminSessionToken(adminConfig) {
  return jwt.sign(
    { sub: 'admin', role: ADMIN_JWT_ROLE },
    adminConfig.sessionSecret,
    { expiresIn: adminConfig.jwtExpiresIn },
  );
}

function setAdminSessionCookie(req, res, token, adminConfig) {
  const maxAge = jwtExpiresToMs(adminConfig.jwtExpiresIn);
  res.cookie(adminConfig.cookieName, token, {
    ...adminCookieBaseOptions(req, adminConfig),
    maxAge,
  });
}

function clearAdminSessionCookie(req, res, adminConfig) {
  res.clearCookie(adminConfig.cookieName, adminCookieBaseOptions(req, adminConfig));
}

/**
 * API: JWT cookie (from POST /api/admin/login) or Basic Auth (curl/scripts).
 */
function createAdminApiAuthMiddleware(adminConfig) {
  return (req, res, next) => {
    if (hasValidSessionCookie(req, adminConfig) || hasValidBasicAuth(req, adminConfig)) {
      return next();
    }
    return res.status(401).json({ error: 'Unauthorized' });
  };
}

const PUBLIC_UI_PATHS = new Set(['/login.html', '/styles.css']);

/**
 * UI: redirect to /ui/login.html if no session (no browser Basic dialog).
 * Public: login page + shared stylesheet for the form.
 */
function createAdminUiGuardMiddleware(adminConfig) {
  return (req, res, next) => {
    const path = req.path || '/';
    if (PUBLIC_UI_PATHS.has(path)) {
      return next();
    }
    if (hasValidSessionCookie(req, adminConfig)) {
      return next();
    }
    const nextUrl = `/ui/login.html?next=${encodeURIComponent(req.originalUrl || '/ui/')}`;
    return res.redirect(302, nextUrl);
  };
}

function warnDefaultAdminPassword(adminConfig) {
  if (!adminConfig.password || adminConfig.password === 'admin') {
    logger.warn('Admin panel: set a strong ADMIN_PASSWORD (and ADMIN_SESSION_SECRET in production).');
  }
}

module.exports = {
  ADMIN_JWT_ROLE,
  parseBasicAuth,
  credentialsMatch,
  hasValidBasicAuth,
  hasValidSessionCookie,
  verifyAdminSessionToken,
  signAdminSessionToken,
  setAdminSessionCookie,
  clearAdminSessionCookie,
  createAdminApiAuthMiddleware,
  createAdminUiGuardMiddleware,
  warnDefaultAdminPassword,
};
