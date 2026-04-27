const INTERVAL_MIN = 60;
const INTERVAL_MAX = 86400;
const DEFAULT_BATCH_PATH = '/v1/ingest/robot-events';

/**
 * @param {unknown} v
 * @returns {boolean}
 */
function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Deep-merge plain objects (fleet defaults + per-robot override). Arrays replaced by source.
 * @param {Record<string, unknown>} base
 * @param {Record<string, unknown>|null|undefined} over
 * @returns {Record<string, unknown>}
 */
function deepMergeDataNodeSyncPartial(base, over) {
  if (!isPlainObject(over)) {
    return { ...base };
  }
  const out = { ...base };
  for (const [k, val] of Object.entries(over)) {
    if (val === undefined) {
      continue;
    }
    if (isPlainObject(val) && isPlainObject(out[k])) {
      out[k] = deepMergeDataNodeSyncPartial(
        /** @type {Record<string, unknown>} */ (out[k]),
        /** @type {Record<string, unknown>} */ (val),
      );
    } else {
      out[k] = val;
    }
  }
  return out;
}

/**
 * @param {unknown} n
 * @param {number} fallback
 */
function clampIntervalSec(n, fallback) {
  const x = Number(n);
  if (!Number.isFinite(x)) {
    return Math.min(Math.max(fallback, INTERVAL_MIN), INTERVAL_MAX);
  }
  return Math.min(Math.max(Math.round(x), INTERVAL_MIN), INTERVAL_MAX);
}

/**
 * Build camelCase dataNodeSync object for robot HTTP (RAID_INTEGRATION.md).
 * Omits authHeaderValue when empty after merge (robot keeps existing token on disk).
 *
 * @param {{
 *   robotId: string,
 *   fleetPartial: Record<string, unknown>|null,
 *   overridePartial: Record<string, unknown>|null,
 * }} p
 * @returns {Record<string, unknown>|null}
 */
function buildDataNodeSyncForRobot({ robotId, fleetPartial, overridePartial }) {
  const merged = deepMergeDataNodeSyncPartial(
    fleetPartial && isPlainObject(fleetPartial) ? fleetPartial : {},
    overridePartial,
  );

  const baseUrl =
    merged.baseUrl != null && String(merged.baseUrl).trim() !== ''
      ? String(merged.baseUrl).trim().replace(/\/+$/, '')
      : '';
  if (!baseUrl) {
    return null;
  }

  const batchPathRaw =
    merged.batchPath != null && String(merged.batchPath).trim() !== ''
      ? String(merged.batchPath).trim()
      : DEFAULT_BATCH_PATH;
  const batchPath = batchPathRaw.startsWith('/') ? batchPathRaw : `/${batchPathRaw}`;

  const enabled =
    merged.enabled === true
    || merged.enabled === 'true'
    || merged.enabled === 1
    || merged.enabled === '1';

  const intervalSec = clampIntervalSec(merged.intervalSec, 300);

  const authHeaderName =
    merged.authHeaderName != null && String(merged.authHeaderName).trim() !== ''
      ? String(merged.authHeaderName).trim()
      : 'Authorization';

  /** @type {Record<string, unknown>} */
  const out = {
    baseUrl,
    batchPath,
    enabled,
    authHeaderName,
    intervalSec,
    raidRobotUuid: robotId,
    includeDashboardEvents: merged.includeDashboardEvents !== false && merged.includeDashboardEvents !== 'false',
    includeAuditEvents: merged.includeAuditEvents !== false && merged.includeAuditEvents !== 'false',
    includeStateUsbSnapshot:
      merged.includeStateUsbSnapshot !== false && merged.includeStateUsbSnapshot !== 'false',
    includeKyrIncidents: merged.includeKyrIncidents !== false && merged.includeKyrIncidents !== 'false',
  };

  const authVal = merged.authHeaderValue;
  if (authVal != null && String(authVal).trim() !== '') {
    out.authHeaderValue = String(authVal).trim();
  }

  return out;
}

/**
 * Fleet env -> partial object for merge (camelCase keys).
 * @param {object|null|undefined} cfg
 * @returns {Record<string, unknown>|null}
 */
function fleetEnvToPartial(cfg) {
  if (!cfg) {
    return null;
  }
  if (cfg.provisionEnabled === false || cfg.provisionEnabled === 'false') {
    return null;
  }
  if (!cfg.provisionEnabled && cfg.provisionEnabled !== 0 && cfg.provisionEnabled !== '0') {
    return null;
  }
  const baseUrl = cfg.baseUrl != null && String(cfg.baseUrl).trim() !== '' ? String(cfg.baseUrl).trim() : '';
  if (!baseUrl) {
    return null;
  }
  const partial = {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    batchPath: cfg.batchPath || DEFAULT_BATCH_PATH,
    enabled: cfg.enabled,
    intervalSec: cfg.intervalSec,
    authHeaderName: cfg.authHeaderName || 'Authorization',
    includeDashboardEvents: cfg.includeDashboardEvents,
    includeAuditEvents: cfg.includeAuditEvents,
    includeStateUsbSnapshot: cfg.includeStateUsbSnapshot,
    includeKyrIncidents: cfg.includeKyrIncidents,
  };
  if (cfg.authHeaderValue != null && String(cfg.authHeaderValue).trim() !== '') {
    partial.authHeaderValue = String(cfg.authHeaderValue).trim();
  }
  return partial;
}

/**
 * @param {object} robot
 * @param {object} config - full app config (config.dataNodeSyncFleet + services-registration file merge)
 * @returns {Record<string, unknown>|null}
 */
function buildDataNodeSyncFromRobot(robot, config) {
  const servicesRegistrationStore = require('./servicesRegistrationStore');
  const fleetCfg = servicesRegistrationStore.getMergedDataNodeSyncFleet(config);
  const fleet = fleetEnvToPartial(fleetCfg);
  const override =
    robot.dataNodeSyncOverride != null && isPlainObject(robot.dataNodeSyncOverride)
      ? /** @type {Record<string, unknown>} */ (robot.dataNodeSyncOverride)
      : null;
  if (!fleet && !override) {
    return null;
  }
  const mergedBase = fleet || {};
  return buildDataNodeSyncForRobot({
    robotId: robot.id,
    fleetPartial: mergedBase,
    overridePartial: override,
  });
}

/**
 * True when merged config would yield a non-null dataNodeSync (for pushDataNodeSync validation).
 * @param {object} robot
 * @param {object} config
 */
function hasDataNodeSyncPayload(robot, config) {
  return buildDataNodeSyncFromRobot(robot, config) != null;
}

module.exports = {
  buildDataNodeSyncForRobot,
  fleetEnvToPartial,
  buildDataNodeSyncFromRobot,
  hasDataNodeSyncPayload,
  deepMergeDataNodeSyncPartial,
  clampIntervalSec,
  DEFAULT_BATCH_PATH,
  INTERVAL_MIN,
  INTERVAL_MAX,
};
