const jwt = require('jsonwebtoken');

function jwtExpiresToMs(expiresIn) {
  const m = String(expiresIn).match(/^(\d+)([smhd])$/i);
  if (!m) {
    return 7 * 24 * 60 * 60 * 1000;
  }
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const mult = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
  return n * (mult[unit] || mult.d);
}

function resolveCookieSecure(req, teleoperatorConfig) {
  const mode = teleoperatorConfig.cookieSecureMode || 'auto';
  if (mode === 'always') {
    return true;
  }
  if (mode === 'never') {
    return false;
  }
  if (!req) {
    return false;
  }
  const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return Boolean(req.secure || forwarded === 'https');
}

function cookieBaseOptions(req, teleoperatorConfig) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: resolveCookieSecure(req, teleoperatorConfig),
    path: '/',
  };
}

function readTokenFromRequest(req, cookieName) {
  if (req.cookies && req.cookies[cookieName]) {
    return req.cookies[cookieName];
  }
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  return null;
}

/**
 * @param {{ jwtSecret: string, cookieName: string }} teleoperatorConfig
 */
function createAttachTeleopUser(teleoperatorConfig) {
  const { jwtSecret, cookieName } = teleoperatorConfig;

  return (req, res, next) => {
    const token = readTokenFromRequest(req, cookieName);
    if (!token) {
      return next();
    }
    try {
      const payload = jwt.verify(token, jwtSecret);
      const sub = payload.sub;
      if (!sub) {
        return next();
      }
      req.teleopUser = {
        id: sub,
        login: typeof payload.login === 'string' ? payload.login : undefined,
      };
    } catch {
      // invalid or expired token — treat as anonymous
    }
    return next();
  };
}

function createRequireTeleopSession({ mode = 'json', loginRedirect } = {}) {
  return (req, res, next) => {
    if (req.teleopUser?.id) {
      return next();
    }
    if (mode === 'redirect' && loginRedirect) {
      return res.redirect(302, loginRedirect);
    }
    return res.status(401).json({ error: 'Unauthorized' });
  };
}

function signTeleopToken(user, teleoperatorConfig) {
  return jwt.sign(
    { sub: user.id, login: user.login },
    teleoperatorConfig.jwtSecret,
    { expiresIn: teleoperatorConfig.jwtExpiresIn },
  );
}

function setTeleopCookie(req, res, token, teleoperatorConfig) {
  const maxAge = jwtExpiresToMs(teleoperatorConfig.jwtExpiresIn);
  res.cookie(teleoperatorConfig.cookieName, token, {
    ...cookieBaseOptions(req, teleoperatorConfig),
    maxAge,
  });
}

function clearTeleopCookie(req, res, teleoperatorConfig) {
  res.clearCookie(teleoperatorConfig.cookieName, cookieBaseOptions(req, teleoperatorConfig));
}

/**
 * Verify teleoperator JWT (same secret as HTTP session). For WebSocket ?token=.
 * @param {string|null|undefined} token
 * @param {{ jwtSecret: string }} teleoperatorConfig
 * @returns {{ id: string, login?: string } | null}
 */
function verifyTeleopToken(token, teleoperatorConfig) {
  if (!token || !teleoperatorConfig?.jwtSecret) {
    return null;
  }
  try {
    const payload = jwt.verify(token, teleoperatorConfig.jwtSecret);
    const sub = payload.sub;
    if (!sub) {
      return null;
    }
    return {
      id: String(sub),
      login: typeof payload.login === 'string' ? payload.login : undefined,
    };
  } catch {
    return null;
  }
}

module.exports = {
  createAttachTeleopUser,
  createRequireTeleopSession,
  signTeleopToken,
  setTeleopCookie,
  clearTeleopCookie,
  jwtExpiresToMs,
  resolveCookieSecure,
  verifyTeleopToken,
};
