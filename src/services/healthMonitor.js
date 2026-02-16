const axios = require('axios');
const logger = require('../utils/logger');

const normalizeHealthPayload = (rawPayload, fallbackMessage, secure = false) => {
  const fallback = fallbackMessage || 'Responded';

  if (!rawPayload || typeof rawPayload !== 'object') {
    return {
      state: 'unknown',
      message: fallback,
      availableMethods: [],
      location: null,
      secure,
    };
  }

  const payload = rawPayload.data && typeof rawPayload.data === 'object'
    ? rawPayload.data
    : rawPayload;

  const state = payload.status || rawPayload.status || 'unknown';
  const message = payload.message || rawPayload.message || fallback;
  const rawMethods = Array.isArray(payload.availableMethods)
    ? payload.availableMethods
    : Array.isArray(rawPayload.availableMethods)
      ? rawPayload.availableMethods
      : [];

  const isHealthMethod = (m) => {
    if (typeof m === 'string') {
      return /^\/?health\/?$/i.test(m.trim());
    }
    const path = (m?.path || m?.description || '').toString().toLowerCase();
    return path === 'health' || path === '/health' || path.endsWith('/health');
  };
  const availableMethods = rawMethods.filter((m) => !isHealthMethod(m));

  const location = payload.location || rawPayload.location || null;

  return {
    state,
    message: message || fallback,
    availableMethods,
    location,
    secure,
  };
};

const createHealthMonitor = ({ config, x402Service }) => {
  const { healthTimeoutMs, defaultHealthEndpoint, defaultSecureHealthEndpoint } = config.robots;

  const buildHealthUrls = (robot) => {
    const baseUrl = `http://${robot.host}:${robot.port}`;
    const urls = [`${baseUrl}${defaultHealthEndpoint}`];
    if (defaultSecureHealthEndpoint !== defaultHealthEndpoint) {
      urls.push(`${baseUrl}${defaultSecureHealthEndpoint}`);
    }
    return urls;
  };

  const probe = async (robot) => {
    const urls = buildHealthUrls(robot);
    let lastError = null;

    for (const url of urls) {
      try {
        const response = await axios.get(url, { timeout: healthTimeoutMs });
        logger.debug('Health check passed', { robotId: robot.id, url });
        return normalizeHealthPayload(response.data, 'Responded', false);
      } catch (error) {
        lastError = error;
        logger.debug('Public health check failed, attempting secure endpoint if applicable', {
          robotId: robot.id,
          url,
          error: error.message,
        });
      }
    }

    if (robot.requiresX402 && x402Service.isConfigured()) {
      try {
        const secureUrl = `http://${robot.host}:${robot.port}${defaultSecureHealthEndpoint}`;
        const response = await x402Service.sendSecuredRequest({
          url: secureUrl,
          method: 'GET',
          timeout: healthTimeoutMs,
        });
        logger.debug('Secure health check passed', { robotId: robot.id });
        return normalizeHealthPayload(response.data, 'Responded via x402', true);
      } catch (error) {
        lastError = error;
      }
    }

    const message = lastError ? lastError.message : 'Health check failed';
    logger.warn('Robot health check failed', { robotId: robot.id, message });
    return {
      state: 'unreachable',
      message,
      availableMethods: [],
      location: null,
      secure: Boolean(robot.requiresX402),
    };
  };

  return {
    probe,
  };
};

module.exports = createHealthMonitor;

