const axios = require('axios');
const logger = require('../utils/logger');
const servicesRegistrationStore = require('./servicesRegistrationStore');

/**
 * Best-effort relay of help request to DATA_NODE (DATA_NODE_INGEST §6, correlation spec §2–3).
 * Failures are logged only; never throws to caller.
 *
 * @param {object} config - app config
 * @param {{ helpRequestId: string, robotId: string, payload: { message?: string, metadata?: object } }} input
 */
async function relayHelpRequestToDataNode(config, input) {
  const r = servicesRegistrationStore.getMergedIncidentRelay(config);
  if (!r?.enabled || !r.url) {
    return;
  }
  const { helpRequestId, robotId, payload } = input;
  const body = {
    schemaVersion: '1.0',
    source: 'raid_help',
    helpRequestId,
    raidRobotUuid: robotId,
    message: payload?.message,
    metadata: payload?.metadata != null && typeof payload.metadata === 'object' ? payload.metadata : {},
  };
  try {
    /** @type {Record<string, string>} */
    const headers = { 'Content-Type': 'application/json' };
    if (r.authHeader && r.authValue) {
      headers[r.authHeader] = r.authValue;
    }
    const method = (r.method || 'POST').toUpperCase();
    const resp = await axios.request({
      url: r.url,
      method,
      data: body,
      headers,
      timeout: 15000,
      validateStatus: () => true,
    });
    if (resp.status < 200 || resp.status >= 300) {
      logger.warn('data node incident relay non-2xx', {
        robotId,
        helpRequestId,
        status: resp.status,
      });
    }
  } catch (err) {
    logger.warn('data node incident relay failed', { robotId, helpRequestId, error: err.message });
  }
}

module.exports = { relayHelpRequestToDataNode };
