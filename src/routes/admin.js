const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');
const {
  createAdminApiAuthMiddleware,
  signAdminSessionToken,
  setAdminSessionCookie,
  clearAdminSessionCookie,
  hasValidSessionCookie,
  credentialsMatch,
} = require('../middleware/adminAuth');
const { createTeleoperatorRepository } = require('../services/teleoperatorRepository');
const { createTeleoperatorRobotGrantRepository } = require('../services/teleoperatorRobotGrantRepository');
const { pushOperatorAllowlistToRobot } = require('../services/robotOperatorSync');

const CONFIG_FILE = path.join(process.cwd(), 'config', 'ai-agent.json');

const createAdminRouter = ({
  settingsStore,
  adminConfig,
  registry = null,
  pool = null,
  config = null,
} = {}) => {
  if (!adminConfig?.sessionSecret) {
    throw new Error('createAdminRouter requires adminConfig.sessionSecret');
  }

  const router = express.Router();

  /**
   * @openapi
   * /api/admin/login:
   *   post:
   *     tags:
   *       - Admin
   *     summary: Admin panel login (sets httpOnly session cookie)
   *     description: Browser UI uses this instead of HTTP Basic. Same credentials as ADMIN_USERNAME / ADMIN_PASSWORD.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/AdminLoginRequest'
   *     responses:
   *       200:
   *         description: Session cookie set (admin_session).
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 ok:
   *                   type: boolean
   *                   example: true
   *       400:
   *         description: Body must be JSON with string username and password.
   *       401:
   *         description: Invalid credentials.
   */
  router.post('/login', (req, res) => {
    const body = req.body;
    if (body === null || body === undefined || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({
        error: 'Expected JSON body: { "username": "…", "password": "…" }',
      });
    }
    const { username, password } = body;
    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({
        error: 'username and password must be JSON strings',
      });
    }
    if (!credentialsMatch(adminConfig, username, password)) {
      logger.warn('Admin login failed (wrong username or password)', {
        attemptUser: username.trim().slice(0, 128),
      });
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = signAdminSessionToken(adminConfig);
    setAdminSessionCookie(req, res, token, adminConfig);
    return res.json({ ok: true });
  });

  /**
   * @openapi
   * /api/admin/logout:
   *   post:
   *     tags:
   *       - Admin
   *     summary: Clear admin session cookie
   *     responses:
   *       200:
   *         description: Cookie cleared.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 ok:
   *                   type: boolean
   */
  router.post('/logout', (req, res) => {
    clearAdminSessionCookie(req, res, adminConfig);
    return res.json({ ok: true });
  });

  /**
   * @openapi
   * /api/admin/session:
   *   get:
   *     tags:
   *       - Admin
   *     summary: Whether a valid admin session cookie is present
   *     responses:
   *       200:
   *         description: Current session state.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 authenticated:
   *                   type: boolean
   */
  router.get('/session', (req, res) => {
    return res.json({ authenticated: hasValidSessionCookie(req, adminConfig) });
  });

  router.use(createAdminApiAuthMiddleware(adminConfig));

  const grantRepository = pool ? createTeleoperatorRobotGrantRepository(pool) : null;
  const teleoperatorRepository =
    pool && config
      ? createTeleoperatorRepository(pool, { bcryptRounds: config.teleoperator.bcryptRounds })
      : null;

  /**
   * @openapi
   * /api/admin/robots:
   *   get:
   *     tags:
   *       - Admin
   *     summary: List robots (includes teleopSecret)
   *     security:
   *       - AdminSessionCookie: []
   *       - AdminBasic: []
   */
  if (registry) {
    router.get('/robots', (req, res) => {
      res.json({ robots: registry.list() });
    });

    /**
     * @openapi
     * /api/admin/robots:
     *   post:
     *     tags:
     *       - Admin
     *     summary: Register robot (full fields)
     *     security:
     *       - AdminSessionCookie: []
     *       - AdminBasic: []
     */
    router.post('/robots', async (req, res, next) => {
      try {
        const {
          name,
          host,
          port,
          requiresX402,
          rosbridgeHost,
          rosbridgePort,
          teleopSecret,
          enrollmentKey,
          operatorRegistryUrl,
          datasetHttpHost,
          datasetHttpPort,
        } = req.body || {};
        if (!host || !port) {
          return res.status(400).json({ error: 'Host and port are required' });
        }
        const robot = await registry.addRobot({
          name,
          host,
          port,
          requiresX402,
          rosbridgeHost,
          rosbridgePort,
          teleopSecret,
          enrollmentKey,
          operatorRegistryUrl,
          datasetHttpHost,
          datasetHttpPort,
        });
        return res.status(201).json(robot);
      } catch (error) {
        return next(error);
      }
    });

    router.put('/robots/:robotId', async (req, res, next) => {
      try {
        const robot = await registry.updateRobot(req.params.robotId, req.body || {});
        return res.json(robot);
      } catch (error) {
        if (error.message === 'Robot not found') {
          return res.status(404).json({ error: 'Robot not found' });
        }
        return next(error);
      }
    });

    router.delete('/robots/:robotId', async (req, res, next) => {
      try {
        const ok = await registry.removeRobot(req.params.robotId);
        if (!ok) {
          return res.status(404).json({ error: 'Robot not found' });
        }
        return res.status(204).send();
      } catch (error) {
        return next(error);
      }
    });

    router.post('/robots/:robotId/refresh', async (req, res, next) => {
      try {
        const robot = await registry.refreshRobot(req.params.robotId);
        return res.json(robot);
      } catch (error) {
        if (error.message === 'Robot not found') {
          return res.status(404).json({ error: 'Robot not found' });
        }
        return next(error);
      }
    });

    /**
     * @openapi
     * /api/admin/robots/{robotId}/sync-operator-allowlist:
     *   post:
     *     tags:
     *       - Admin
     *     summary: Push allowed teleoperator IDs to robot (optional HTTP API)
     *     security:
     *       - AdminSessionCookie: []
     *       - AdminBasic: []
     */
    router.post('/robots/:robotId/sync-operator-allowlist', async (req, res) => {
      if (!grantRepository) {
        return res.status(503).json({ error: 'Database not configured' });
      }
      const robot = registry.getById(req.params.robotId);
      if (!robot) {
        return res.status(404).json({ error: 'Robot not found' });
      }
      const ids = await grantRepository.listActiveTeleoperatorIdsForRobot(req.params.robotId);
      const result = await pushOperatorAllowlistToRobot({
        robot,
        raidToRobotSecret: config?.robots?.raidToRobotSecret ?? null,
        allowedTeleoperatorIds: ids,
      });
      return res.json({ ok: true, robotId: robot.id, ...result });
    });
  }

  if (pool && grantRepository && teleoperatorRepository && registry) {
    /**
     * @openapi
     * /api/admin/teleoperators:
     *   get:
     *     tags:
     *       - Admin
     *     summary: List teleoperator accounts (public fields)
     *     security:
     *       - AdminSessionCookie: []
     *       - AdminBasic: []
     */
    router.get('/teleoperators', async (req, res, next) => {
      try {
        const users = await teleoperatorRepository.listAllPublic();
        return res.json({ teleoperators: users });
      } catch (error) {
        return next(error);
      }
    });

    /**
     * @openapi
     * /api/admin/teleoperator-grants:
     *   get:
     *     tags:
     *       - Admin
     *     summary: List active teleoperator–robot grants
     *     security:
     *       - AdminSessionCookie: []
     *       - AdminBasic: []
     */
    router.get('/teleoperator-grants', async (req, res, next) => {
      try {
        const rows = await grantRepository.listActive();
        return res.json({
          grants: rows.map((g) => ({
            teleoperatorId: g.teleoperator_id,
            robotId: g.robot_id,
            teleoperatorLogin: g.teleoperator_login,
            createdAt: g.created_at,
          })),
        });
      } catch (error) {
        return next(error);
      }
    });

    router.post('/teleoperator-grants', async (req, res, next) => {
      try {
        const { teleoperatorId, robotId } = req.body || {};
        if (!teleoperatorId || !robotId) {
          return res.status(400).json({ error: 'teleoperatorId and robotId are required' });
        }
        const op = await teleoperatorRepository.findPublicById(teleoperatorId);
        if (!op) {
          return res.status(404).json({ error: 'Teleoperator not found' });
        }
        if (registry && !registry.getById(robotId)) {
          return res.status(404).json({ error: 'Robot not found' });
        }
        const row = await grantRepository.grant({ teleoperatorId, robotId });
        return res.status(201).json({
          grant: {
            teleoperatorId: row.teleoperator_id,
            robotId: row.robot_id,
            createdAt: row.created_at,
          },
        });
      } catch (error) {
        return next(error);
      }
    });

    router.delete('/teleoperator-grants/:teleoperatorId/:robotId', async (req, res, next) => {
      try {
        const { teleoperatorId, robotId } = req.params;
        const ok = await grantRepository.revoke({ teleoperatorId, robotId });
        if (!ok) {
          return res.status(404).json({ error: 'Active grant not found' });
        }
        return res.status(204).send();
      } catch (error) {
        return next(error);
      }
    });
  }

  /**
   * @openapi
   * /api/admin/ai-agent:
   *   get:
   *     tags:
   *       - Admin
   *     summary: Get AI agent configuration
   *     security:
   *       - AdminSessionCookie: []
   *       - AdminBasic: []
   *     responses:
   *       200:
   *         description: Current AI agent JSON config.
   */
  router.get('/ai-agent', async (req, res) => {
    try {
      const fileContent = await fs.readFile(CONFIG_FILE, 'utf-8').catch(() => '{}');
      const parsed = JSON.parse(fileContent);
      res.json(parsed);
    } catch (error) {
      logger.error('Failed to read AI agent config', { error: error.message });
      res.json({});
    }
  });

  /**
   * @openapi
   * /api/admin/ai-agent:
   *   post:
   *     tags:
   *       - Admin
   *     summary: Save AI agent configuration
   *     security:
   *       - AdminSessionCookie: []
   *       - AdminBasic: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *     responses:
   *       200:
   *         description: Saved.
   *       400:
   *         description: Invalid strategy.
   */
  router.post('/ai-agent', async (req, res) => {
    try {
      const body = req.body;

      if (body.strategy && !['smart', 'lowest_price', 'closest', 'fastest'].includes(body.strategy)) {
        return res.status(400).json({ error: 'Invalid strategy' });
      }

      await fs.mkdir(path.dirname(CONFIG_FILE), { recursive: true });
      await fs.writeFile(CONFIG_FILE, JSON.stringify(body, null, 2), 'utf-8');

      if (body.strategy) {
        process.env.AI_AGENT_STRATEGY = body.strategy;
      }
      if (body.n8nWebhookUrl) {
        process.env.N8N_WEBHOOK_URL = body.n8nWebhookUrl;
      }

      logger.info('AI Agent configuration saved', { strategy: body.strategy });
      res.json({ success: true, config: body });
    } catch (error) {
      logger.error('Failed to save AI agent config', { error: error.message });
      res.status(500).json({ error: 'Failed to save configuration' });
    }
  });

  /**
   * @openapi
   * /api/admin/client-settings:
   *   get:
   *     tags:
   *       - Admin
   *     summary: Get client RPC settings (masked Helius key)
   *     security:
   *       - AdminSessionCookie: []
   *       - AdminBasic: []
   */
  router.get('/client-settings', (req, res) => {
    try {
      const settings = settingsStore?.getSettings?.() ?? {};
      res.json({
        rpcProvider: settings.rpcProvider || 'public',
        hasHeliusKey: Boolean(settings.hasHeliusKey),
        customRpcUrl: settings.customRpcUrl || null,
      });
    } catch (error) {
      logger.error('Failed to get client settings', { error: error.message });
      res.status(500).json({ error: 'Failed to get settings' });
    }
  });

  /**
   * @openapi
   * /api/admin/client-settings:
   *   post:
   *     tags:
   *       - Admin
   *     summary: Save client RPC settings
   *     security:
   *       - AdminSessionCookie: []
   *       - AdminBasic: []
   */
  router.post('/client-settings', (req, res) => {
    try {
      const { rpcProvider, heliusApiKey, customRpcUrl } = req.body ?? {};
      const updated = settingsStore?.saveSettings?.({
        rpcProvider,
        heliusApiKey,
        customRpcUrl,
      }) ?? {};
      logger.info('Client RPC settings saved from admin', { rpcProvider: updated.rpcProvider });
      res.json(updated);
    } catch (error) {
      logger.error('Failed to save client settings', { error: error.message });
      res.status(500).json({ error: 'Failed to save settings' });
    }
  });

  return router;
};

module.exports = createAdminRouter;
