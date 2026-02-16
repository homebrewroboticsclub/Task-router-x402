const logger = require('../utils/logger');

const createAuthMiddleware = (config = {}) => {
  const username = config.username || process.env.ADMIN_USERNAME || 'admin';
  const password = config.password || process.env.ADMIN_PASSWORD || 'admin';

  if (!password || password === 'admin') {
    logger.warn('Admin panel is using default password. Please set ADMIN_PASSWORD environment variable.');
  }

  return (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Basic ')) {
      res.setHeader('WWW-Authenticate', 'Basic realm="x402 Task Router Admin Panel"');
      return res.status(401).send('Unauthorized');
    }

    const credentials = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
    const [providedUsername, providedPassword] = credentials.split(':');

    if (providedUsername === username && providedPassword === password) {
      return next();
    }

    res.setHeader('WWW-Authenticate', 'Basic realm="x402 Task Router Admin Panel"');
    return res.status(401).send('Unauthorized');
  };
};

module.exports = createAuthMiddleware;
