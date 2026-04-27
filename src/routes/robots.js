const express = require('express');
const { createRequireFleetOrAdmin, createRequireFleetEnrollment } = require('../middleware/robotFleetAuth');
const { buildDataNodeSyncFromRobot } = require('../services/dataNodeSyncProvision');
const { omitOperatorProvisioningFields } = require('../services/robotRepository');
const servicesRegistrationStore = require('../services/servicesRegistrationStore');

/**
 * @param {{ registry: object, config: object, adminConfig: object }} deps
 */
const createRobotsRouter = ({ registry, config, adminConfig }) => {
  const router = express.Router();
  const fleetSecret = servicesRegistrationStore.getEffectiveFleetEnrollmentSecret(config);
  const requireFleetOrAdmin = createRequireFleetOrAdmin({ fleetEnrollmentSecret: fleetSecret, adminConfig });
  const requireFleetEnrollment = createRequireFleetEnrollment({ fleetEnrollmentSecret: fleetSecret });

  /**
   * @openapi
   * /api/robots:
   *   get:
   *     tags:
   *       - Robots
   *     summary: List registered robots (public, no secrets)
   *     description: >
   *       Returns robots without teleopSecret. For full fields including secrets use admin API
   *       GET /api/admin/robots with admin session or Basic Auth.
   *     responses:
   *       200:
   *         description: Current robot registry (sanitized).
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 robots:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/RobotPublic'
   */
  router.get('/', (req, res) => {
    res.json({ robots: registry.listPublic() });
  });

  /**
   * @openapi
   * /api/robots/enroll:
   *   post:
   *     tags:
   *       - Robots
   *     summary: Fleet self-enrollment (idempotent upsert)
   *     description: >
   *       Requires ROBOT_FLEET_ENROLLMENT_SECRET as Bearer token or X-Robot-Fleet-Secret.
   *       Upserts by stable enrollmentKey; returns robot including teleopSecret (store on device).
   *     security:
   *       - RobotFleetBearer: []
   *       - RobotFleetHeader: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/RobotEnrollRequest'
   *     responses:
   *       201:
   *         description: Created or updated robot (includes teleopSecret).
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Robot'
   *       400:
   *         description: Validation error.
   *       401:
   *         description: Invalid fleet credential.
   *       503:
   *         description: Fleet enrollment not configured.
   */
  router.post('/enroll', requireFleetEnrollment, async (req, res, next) => {
    try {
      const {
        enrollmentKey,
        name,
        host,
        port,
        requiresX402,
        rosbridgeHost,
        rosbridgePort,
        teleopSecret,
        operatorRegistryUrl,
        datasetHttpHost,
        datasetHttpPort,
      } = req.body || {};
      if (!host || port == null) {
        return res.status(400).json({ error: 'host and port are required' });
      }
      const robot = await registry.enrollOrUpdateRobot({
        enrollmentKey,
        name,
        host,
        port,
        requiresX402,
        rosbridgeHost,
        rosbridgePort,
        teleopSecret,
        operatorRegistryUrl,
        datasetHttpHost,
        datasetHttpPort,
      });
      try {
        await registry.refreshRobot(robot.id);
      } catch (e) {
        /* non-fatal */
      }
      const full = registry.getById(robot.id);
      const payload = { ...omitOperatorProvisioningFields(full) };
      const dataNodeSync = buildDataNodeSyncFromRobot(full, config);
      if (dataNodeSync != null) {
        payload.dataNodeSync = dataNodeSync;
      }
      return res.status(200).json(payload);
    } catch (error) {
      if (error.message === 'enrollmentKey is required') {
        return res.status(400).json({ error: error.message });
      }
      return next(error);
    }
  });

  /**
   * @openapi
   * /api/robots:
   *   post:
   *     tags:
   *       - Robots
   *     summary: Register a robot (admin or fleet credential)
   *     description: >
   *       Requires admin session/Basic Auth, or ROBOT_FLEET_ENROLLMENT_SECRET as Bearer / X-Robot-Fleet-Secret.
   *       Each call creates a new UUID unless you use POST /api/robots/enroll with enrollmentKey.
   *     security:
   *       - AdminSessionCookie: []
   *       - AdminBasic: []
   *       - RobotFleetBearer: []
   *       - RobotFleetHeader: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/RegisterRobotRequest'
   *     responses:
   *       201:
   *         description: Robot added.
   *       401:
   *         description: Not authorized.
   */
  router.post('/', requireFleetOrAdmin, async (req, res, next) => {
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
      const out = { ...omitOperatorProvisioningFields(robot) };
      const dns = buildDataNodeSyncFromRobot(robot, config);
      if (dns != null) {
        out.dataNodeSync = dns;
      }
      return res.status(201).json(out);
    } catch (error) {
      return next(error);
    }
  });

  /**
   * @openapi
   * /api/robots/{robotId}:
   *   put:
   *     tags:
   *       - Robots
   *     summary: Update robot metadata
   *     security:
   *       - AdminSessionCookie: []
   *       - AdminBasic: []
   *       - RobotFleetBearer: []
   *       - RobotFleetHeader: []
   */
  router.put('/:robotId', requireFleetOrAdmin, async (req, res, next) => {
    try {
      const { robotId } = req.params;
      const updates = req.body;
      const robot = await registry.updateRobot(robotId, updates);
      const out = { ...omitOperatorProvisioningFields(robot) };
      const dns = buildDataNodeSyncFromRobot(robot, config);
      if (dns != null) {
        out.dataNodeSync = dns;
      }
      return res.json(out);
    } catch (error) {
      if (error.message === 'Robot not found') {
        return res.status(404).json({ error: 'Robot not found' });
      }
      return next(error);
    }
  });

  /**
   * @openapi
   * /api/robots/{robotId}:
   *   delete:
   *     tags:
   *       - Robots
   *     summary: Remove robot from registry
   *     security:
   *       - AdminSessionCookie: []
   *       - AdminBasic: []
   *       - RobotFleetBearer: []
   *       - RobotFleetHeader: []
   */
  router.delete('/:robotId', requireFleetOrAdmin, async (req, res, next) => {
    try {
      const { robotId } = req.params;
      const result = await registry.removeRobot(robotId);
      if (!result) {
        return res.status(404).json({ error: 'Robot not found' });
      }
      return res.status(204).send();
    } catch (error) {
      return next(error);
    }
  });

  /**
   * @openapi
   * /api/robots/{robotId}/refresh:
   *   post:
   *     tags:
   *       - Robots
   *     summary: Trigger a robot health check
   *     security:
   *       - AdminSessionCookie: []
   *       - AdminBasic: []
   *       - RobotFleetBearer: []
   *       - RobotFleetHeader: []
   */
  router.post('/:robotId/refresh', requireFleetOrAdmin, async (req, res, next) => {
    try {
      const { robotId } = req.params;
      const robot = await registry.refreshRobot(robotId);
      const out = { ...omitOperatorProvisioningFields(robot) };
      const dns = buildDataNodeSyncFromRobot(robot, config);
      if (dns != null) {
        out.dataNodeSync = dns;
      }
      return res.json(out);
    } catch (error) {
      if (error.message === 'Robot not found') {
        return res.status(404).json({ error: 'Robot not found' });
      }
      return next(error);
    }
  });

  return router;
};

module.exports = createRobotsRouter;
