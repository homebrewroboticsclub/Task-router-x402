const path = require('path');
const express = require('express');
const cors = require('cors');
const { loadConfig } = require('./config');
const logger = require('./utils/logger');
const X402Service = require('./services/x402Service');
const createHealthMonitor = require('./services/healthMonitor');
const RobotRegistry = require('./services/robotRegistry');
const createCommandRouter = require('./services/commandRouter');
const createRobotsRouter = require('./routes/robots');
const createCommandsRouter = require('./routes/commands');
const createX402PaymentMiddleware = require('./middleware/x402Payment');
const { swaggerSpec, swaggerUi } = require('./docs/swagger');

const bootstrap = () => {
  const config = loadConfig(process.argv.slice(2));
  const { server } = config;

  const x402Service = new X402Service(config.x402);
  const healthMonitor = createHealthMonitor({ config, x402Service });
  const registry = new RobotRegistry({ healthMonitor });
  const commandRouter = createCommandRouter({ config, registry, x402Service });

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.use('/ui', express.static(path.join(__dirname, '..', 'public')));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { explorer: true }));
  app.get('/docs-json', (req, res) => {
    res.json(swaggerSpec);
  });

  /**
   * @openapi
   * /health:
   *   get:
   *     tags:
   *       - Health
   *     summary: Service readiness snapshot
   *     description: Returns uptime information and high-level robot counts.
   *     responses:
   *       200:
   *         description: Service is online.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 status:
   *                   type: string
   *                   example: ok
   *                 timestamp:
   *                   type: string
   *                   format: date-time
   *                 robots:
   *                   type: integer
   *                   example: 3
   *                 x402Configured:
   *                   type: boolean
   *                   example: true
   */
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      robots: registry.list().length,
      x402Configured: x402Service.isConfigured(),
    });
  });

  app.use('/api/robots', createRobotsRouter({ registry }));
  app.use('/api/commands', createCommandsRouter({ commandRouter }));

  /**
   * @openapi
   * /api/payments/x402:
   *   post:
   *     tags:
   *       - Payments
   *     summary: Validate incoming x402 payment callback
   *     description: Verifies payload signature using the configured private key and echoes the payload.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             additionalProperties: true
   *     responses:
   *       200:
   *         description: Signature is valid.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 status:
   *                   type: string
   *                 payload:
   *                   type: object
   *                   additionalProperties: true
   *       401:
   *         description: Missing or invalid signature.
   *       503:
   *         description: x402 verification is not configured.
   */
  app.post(
    '/api/payments/x402',
    createX402PaymentMiddleware(x402Service),
    (req, res) => {
      res.json({
        status: 'payment_verified',
        payload: req.body,
      });
    },
  );

  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  });

  app.use((err, req, res, next) => {
    logger.error('Unhandled error', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message || 'Internal server error' });
  });

  const serverInstance = app.listen(server.port, server.host, () => {
    logger.info('x402 Raid App server started', {
      host: server.host,
      port: server.port,
      x402Configured: x402Service.isConfigured(),
    });
  });

  return serverInstance;
};

if (require.main === module) {
  bootstrap();
}

module.exports = { bootstrap };

