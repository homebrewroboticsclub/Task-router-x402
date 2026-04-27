const axios = require('axios');
const logger = require('../utils/logger');

/**
 * Push allowlist and/or dataNodeSync to robot operatorRegistryUrl (docs/ROBOT_OPERATOR_SYNC.md, RAID_INTEGRATION.md).
 * @param {{
 *   robot: object,
 *   raidToRobotSecret: string|null,
 *   allowedTeleoperatorIds?: string[],
 *   dataNodeSync?: object|null,
 *   pushAllowlist: boolean,
 *   pushDataNodeSync: boolean,
 * }} p
 * @returns {Promise<{ skipped?: boolean, reason?: string, ok?: boolean, error?: string }>}
 */
async function pushRobotProvisionToRobot(p) {
  const {
    robot,
    raidToRobotSecret,
    allowedTeleoperatorIds,
    dataNodeSync,
    pushAllowlist,
    pushDataNodeSync,
  } = p;
  const url = robot?.operatorRegistryUrl;
  if (!url || String(url).trim() === '') {
    return { skipped: true, reason: 'operator_registry_url not set on robot' };
  }
  if (!raidToRobotSecret) {
    return { skipped: true, reason: 'RAID_TO_ROBOT_SECRET not configured' };
  }

  /** @type {Record<string, unknown>} */
  const body = {};
  if (pushAllowlist) {
    body.allowedTeleoperatorIds = Array.isArray(allowedTeleoperatorIds) ? allowedTeleoperatorIds : [];
  }
  if (pushDataNodeSync && dataNodeSync != null && typeof dataNodeSync === 'object') {
    body.dataNodeSync = dataNodeSync;
  }

  if (Object.keys(body).length === 0) {
    return { skipped: true, reason: 'nothing_to_push' };
  }

  try {
    await axios.post(String(url).trim(), body, {
      headers: {
        'Content-Type': 'application/json',
        'X-Raid-To-Robot-Secret': raidToRobotSecret,
      },
      timeout: 10000,
      validateStatus: (s) => s >= 200 && s < 300,
    });
    return { ok: true };
  } catch (error) {
    const msg = error.response?.data?.error || error.message || 'request failed';
    logger.warn('pushRobotProvisionToRobot failed', { robotId: robot.id, error: msg });
    return { ok: false, error: msg };
  }
}

/** @deprecated Use pushRobotProvisionToRobot */
async function pushOperatorAllowlistToRobot(p) {
  return pushRobotProvisionToRobot({
    robot: p.robot,
    raidToRobotSecret: p.raidToRobotSecret,
    allowedTeleoperatorIds: p.allowedTeleoperatorIds,
    pushAllowlist: true,
    pushDataNodeSync: false,
  });
}

module.exports = {
  pushRobotProvisionToRobot,
  pushOperatorAllowlistToRobot,
};
