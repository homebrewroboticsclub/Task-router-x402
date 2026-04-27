const http = require('http');
const logger = require('../utils/logger');

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const FORWARD_REQUEST_HEADERS = new Set([
  'content-type',
  'content-length',
  'accept',
  'accept-encoding',
  'accept-language',
  'if-match',
  'if-none-match',
  'if-modified-since',
  'if-unmodified-since',
  'range',
  'user-agent',
]);

/**
 * @param {object} robot
 * @returns {{ host: string, port: number }}
 */
function resolveDatasetUpstream(robot) {
  const hostRaw = robot.datasetHttpHost != null && String(robot.datasetHttpHost).trim() !== ''
    ? String(robot.datasetHttpHost).trim()
    : robot.host;
  const port =
    robot.datasetHttpPort != null && !Number.isNaN(Number(robot.datasetHttpPort))
      ? Number(robot.datasetHttpPort)
      : 9191;
  return { host: hostRaw, port };
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {{ id: string, login?: string }} teleopUser
 * @param {{ host: string, port: number }} upstream
 * @param {boolean} secure
 */
function buildUpstreamHeaders(req, teleopUser, upstream, secure) {
  /** @type {Record<string, string | string[]>} */
  const headers = {};
  for (const name of FORWARD_REQUEST_HEADERS) {
    const v = req.headers[name];
    if (v !== undefined && v !== '') {
      headers[name] = v;
    }
  }
  const chain = [];
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.trim()) {
    chain.push(xf.trim());
  }
  const remote = req.socket?.remoteAddress;
  if (remote) {
    chain.push(remote);
  }
  headers['x-forwarded-for'] = chain.join(', ');
  headers['x-forwarded-proto'] = secure ? 'https' : 'http';
  headers['x-teleoperator-id'] = String(teleopUser.id);
  if (teleopUser.login) {
    headers['x-teleoperator-login'] = String(teleopUser.login);
  }
  headers.host = `${upstream.host}:${upstream.port}`;
  return headers;
}

/**
 * @param {import('http').IncomingMessage} res
 * @param {import('http').IncomingMessage} upstreamRes
 */
function copyUpstreamHeaders(res, upstreamRes) {
  for (const [key, value] of Object.entries(upstreamRes.headers)) {
    if (!key || HOP_BY_HOP.has(key.toLowerCase())) {
      continue;
    }
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const v of value) {
        if (v != null) {
          res.append(key, v);
        }
      }
    } else {
      res.setHeader(key, value);
    }
  }
}

/**
 * HTTP reverse proxy to the robot dataset API (transparent; no JWT to upstream).
 *
 * @param {{
 *   registry: object,
 *   grantRepository: ReturnType<import('./teleoperatorRobotGrantRepository').createTeleoperatorRobotGrantRepository> | null,
 *   timeoutMs: number,
 * }} deps
 * @returns {import('express').RequestHandler}
 */
function createTeleopDatasetProxyMiddleware({ registry, grantRepository, timeoutMs }) {
  return async function teleopDatasetProxy(req, res, next) {
    const pathOnly = (req.url || '').split('?')[0];
    const m = pathOnly.match(/^\/robots\/([^/]+)\/dataset(?:\/(.*))?$/);
    if (!m) {
      return next();
    }

    const robotId = m[1];
    const rest = m[2];
    const upstreamPath =
      rest != null && rest !== ''
        ? `/${rest}`
        : '/';
    const qIndex = (req.url || '').indexOf('?');
    const queryString = qIndex >= 0 ? (req.url || '').slice(qIndex) : '';

    const teleopUser = req.teleopUser;
    if (!teleopUser?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const robot = registry.getById(robotId);
    if (!robot) {
      return res.status(404).json({ error: 'Robot not found' });
    }

    try {
      if (grantRepository) {
        const grantCount = await grantRepository.countActiveGrantsForRobot(robotId);
        if (grantCount > 0) {
          const allowed = await grantRepository.hasActiveGrant({
            teleoperatorId: teleopUser.id,
            robotId,
          });
          if (!allowed) {
            return res.status(403).json({ error: 'Operator not authorized for this robot' });
          }
        }
      }
    } catch (error) {
      logger.error('dataset proxy grant check failed', { error: error.message, robotId });
      return res.status(500).json({ error: 'Authorization check failed' });
    }

    const upstream = resolveDatasetUpstream(robot);
    const secure = Boolean(req.secure);
    const headers = buildUpstreamHeaders(req, teleopUser, upstream, secure);

    let responded = false;
    const fail = (status, message) => {
      if (responded) {
        return;
      }
      responded = true;
      if (!res.headersSent) {
        res.status(status).json({ error: message });
      } else {
        try {
          res.end();
        } catch {
          /* ignore */
        }
      }
    };

    /** @type {import('http').ClientRequest | null} */
    let upstreamReq = null;

    const cleanup = () => {
      if (upstreamReq && !upstreamReq.destroyed) {
        try {
          upstreamReq.destroy();
        } catch {
          /* ignore */
        }
      }
      upstreamReq = null;
    };

    req.on('aborted', cleanup);
    res.on('close', cleanup);

    try {
      upstreamReq = http.request(
        {
          hostname: upstream.host,
          port: upstream.port,
          method: req.method,
          path: `${upstreamPath}${queryString}`,
          headers,
          timeout: timeoutMs,
        },
        (upstreamRes) => {
          if (responded) {
            upstreamRes.resume();
            return;
          }
          responded = true;
          res.status(upstreamRes.statusCode || 502);
          copyUpstreamHeaders(res, upstreamRes);
          upstreamRes.pipe(res);
          upstreamRes.on('error', (err) => {
            logger.warn('dataset proxy upstream response error', { message: err.message, robotId });
            cleanup();
            if (!res.writableEnded) {
              try {
                res.destroy();
              } catch {
                /* ignore */
              }
            }
          });
        },
      );

      upstreamReq.on('timeout', () => {
        logger.warn('dataset proxy upstream timeout', { robotId, upstream });
        cleanup();
        fail(504, 'Upstream timeout');
      });

      upstreamReq.on('error', (err) => {
        logger.warn('dataset proxy upstream connect error', {
          message: err.message,
          robotId,
          upstream,
        });
        cleanup();
        fail(502, 'Bad gateway');
      });

      req.pipe(upstreamReq);
    } catch (error) {
      logger.error('dataset proxy request failed', { error: error.message, robotId });
      cleanup();
      return fail(502, 'Bad gateway');
    }

    return undefined;
  };
}

module.exports = {
  createTeleopDatasetProxyMiddleware,
  resolveDatasetUpstream,
  FORWARD_REQUEST_HEADERS,
};
