const axios = require('axios');
const logger = require('../utils/logger');

/**
 * Push allowlist to robot HTTP API (optional; robot must implement contract in docs/ROBOT_OPERATOR_SYNC.md).
 * @param {{ robot: object, raidToRobotSecret: string|null, allowedTeleoperatorIds: string[] }} p
 * @returns {Promise<{ skipped?: boolean, reason?: string, ok?: boolean, error?: string }>}
 */
async function pushOperatorAllowlistToRobot(p) {
  const { robot, raidToRobotSecret, allowedTeleoperatorIds } = p;
  const url = robot?.operatorRegistryUrl;
  if (!url || String(url).trim() === '') {
    return { skipped: true, reason: 'operator_registry_url not set on robot' };
  }
  if (!raidToRobotSecret) {
    return { skipped: true, reason: 'RAID_TO_ROBOT_SECRET not configured' };
  }
  try {
    await axios.post(
      String(url).trim(),
      { allowedTeleoperatorIds },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Raid-To-Robot-Secret': raidToRobotSecret,
        },
        timeout: 10000,
        validateStatus: (s) => s >= 200 && s < 300,
      },
    );
    return { ok: true };
  } catch (error) {
    const msg = error.response?.data?.error || error.message || 'request failed';
    logger.warn('pushOperatorAllowlistToRobot failed', { robotId: robot.id, error: msg });
    return { ok: false, error: msg };
  }
}

module.exports = { pushOperatorAllowlistToRobot };
