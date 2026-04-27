const express = require('express');
const logger = require('../utils/logger');
const { createTeleoperatorRepository } = require('../services/teleoperatorRepository');
const {
  createAttachTeleopUser,
  createRequireTeleopSession,
  signTeleopToken,
  setTeleopCookie,
  clearTeleopCookie,
} = require('../middleware/teleopSession');

/**
 * @param {{ pool: import('pg').Pool, config: object }} deps
 */
const createTeleoperatorRouter = ({ pool, config }) => {
  const teleoperatorRepository = createTeleoperatorRepository(pool, {
    bcryptRounds: config.teleoperator.bcryptRounds,
  });
  const attachTeleopUser = createAttachTeleopUser(config.teleoperator);
  const requireTeleopSession = createRequireTeleopSession({ mode: 'json' });

  const router = express.Router();
  router.use(attachTeleopUser);

  /**
   * @openapi
   * /api/teleoperator/register:
   *   post:
   *     tags:
   *       - Teleoperator
   *     summary: Register teleoperator account
   *     description: Creates a user with bcrypt-hashed password and Solana wallet public key; sets session cookie and returns accessToken (same JWT) for native clients.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/TeleoperatorRegisterRequest'
   *     responses:
   *       201:
   *         description: Registered; JWT cookie set.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/TeleoperatorAuthResponse'
   *       400:
   *         description: Validation error.
   *       409:
   *         description: Login already taken.
   */
  router.post('/register', async (req, res) => {
    try {
      const { login, password, walletPublicKey } = req.body || {};
      const user = await teleoperatorRepository.createUser({ login, password, walletPublicKey });
      const token = signTeleopToken({ id: user.id, login: user.login }, config.teleoperator);
      setTeleopCookie(req, res, token, config.teleoperator);
      return res.status(201).json({ ok: true, user, accessToken: token });
    } catch (error) {
      if (error.code === 'VALIDATION') {
        return res.status(400).json({ error: error.message });
      }
      if (error.code === 'CONFLICT') {
        return res.status(409).json({ error: error.message });
      }
      logger.error('Teleoperator register failed', { error: error.message });
      return res.status(500).json({ error: 'Registration failed' });
    }
  });

  /**
   * @openapi
   * /api/teleoperator/login:
   *   post:
   *     tags:
   *       - Teleoperator
   *     summary: Login with login and password
   *     description: Sets httpOnly session cookie (JWT) and returns accessToken for Authorization Bearer from apps.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/TeleoperatorLoginRequest'
   *     responses:
   *       200:
   *         description: Authenticated.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/TeleoperatorAuthResponse'
   *       401:
   *         description: Invalid credentials.
   */
  router.post('/login', async (req, res) => {
    try {
      const { login, password } = req.body || {};
      const loginNormalized = teleoperatorRepository.normalizeLogin(login);
      const row = await teleoperatorRepository.findWithSecretByLoginNormalized(loginNormalized);
      const valid = row && (await teleoperatorRepository.verifyPassword(row, password));
      if (!valid) {
        return res.status(401).json({ error: 'Invalid login or password' });
      }
      const user = teleoperatorRepository.toPublicProfile(row);
      const token = signTeleopToken({ id: user.id, login: user.login }, config.teleoperator);
      setTeleopCookie(req, res, token, config.teleoperator);
      return res.json({ ok: true, user, accessToken: token });
    } catch (error) {
      logger.error('Teleoperator login failed', { error: error.message });
      return res.status(500).json({ error: 'Login failed' });
    }
  });

  /**
   * @openapi
   * /api/teleoperator/logout:
   *   post:
   *     tags:
   *       - Teleoperator
   *     summary: Clear session cookie
   *     responses:
   *       200:
   *         description: Logged out.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 ok:
   *                   type: boolean
   */
  router.post('/logout', (req, res) => {
    clearTeleopCookie(req, res, config.teleoperator);
    return res.json({ ok: true });
  });

  /**
   * @openapi
   * /api/teleoperator/me:
   *   get:
   *     tags:
   *       - Teleoperator
   *     summary: Current teleoperator profile
   *     security:
   *       - TeleoperatorCookie: []
   *       - TeleoperatorBearer: []
   *     responses:
   *       200:
   *         description: Public profile (no password hash).
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 user:
   *                   $ref: '#/components/schemas/TeleoperatorPublicProfile'
   *       401:
   *         description: Not authenticated.
   */
  router.get('/me', requireTeleopSession, async (req, res) => {
    const user = await teleoperatorRepository.findPublicById(req.teleopUser.id);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    return res.json({ user });
  });

  return router;
};

module.exports = createTeleoperatorRouter;
