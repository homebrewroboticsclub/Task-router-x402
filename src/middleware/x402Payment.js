const logger = require('../utils/logger');

const createX402PaymentMiddleware = (x402Service) => (req, res, next) => {
  if (!x402Service.isConfigured()) {
    logger.warn('Received x402 protected request but service is not configured');
    return res.status(503).json({ error: 'x402 payment verification is not configured' });
  }

  const signature = req.headers['x-402-signature'];
  const payload = req.body || {};

  const isValid = x402Service.verifyIncomingSignature({
    signature,
    payload,
  });

  if (!isValid) {
    logger.warn('Invalid x402 signature', { path: req.path });
    return res.status(401).json({ error: 'Invalid x402 signature' });
  }

  return next();
};

module.exports = createX402PaymentMiddleware;

