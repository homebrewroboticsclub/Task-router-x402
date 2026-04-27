const path = require('path');
const fs = require('fs');
const { randomBytes } = require('crypto');
const logger = require('../utils/logger');

const REG_FILE = path.join(process.cwd(), 'config', 'services-registration.json');

/** @type {object|null} */
let configSnapshot = null;
/** @type {Record<string, unknown>} */
let fileData = {};

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function loadFromDisk() {
  try {
    if (fs.existsSync(REG_FILE)) {
      const raw = fs.readFileSync(REG_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      fileData = isPlainObject(parsed) ? parsed : {};
      logger.debug('Services registration loaded', { file: REG_FILE });
    } else {
      fileData = {};
    }
  } catch (error) {
    logger.warn('Could not load services-registration file', { path: REG_FILE, error: error.message });
    fileData = {};
  }
}

/**
 * @param {object} config
 */
function init(config) {
  configSnapshot = config;
  loadFromDisk();
}

function persist() {
  const dir = path.dirname(REG_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  try {
    fs.writeFileSync(REG_FILE, JSON.stringify(fileData, null, 2), 'utf8');
    logger.info('Services registration saved', { file: REG_FILE });
  } catch (e) {
    if (e && (e.code === 'EACCES' || e.code === 'EPERM')) {
      const err = new Error(
        `Cannot write ${REG_FILE}: permission denied. The file must be owned by the user running the server (not root). Example: sudo chown "$(whoami)" "${REG_FILE}"`,
      );
      err.code = e.code;
      throw err;
    }
    throw e;
  }
}

/**
 * Fleet partial from file (camelCase, same keys as config.dataNodeSyncFleet).
 * @returns {Record<string, unknown>}
 */
function getFileDataNodeSyncFleet() {
  const f = fileData.dataNodeSyncFleet;
  return isPlainObject(f) ? /** @type {Record<string, unknown>} */ (f) : {};
}

/**
 * @param {object} envFleet
 * @param {Record<string, unknown>} fileFleet
 */
function mergeDataNodeSyncFleet(envFleet, fileFleet) {
  const merged = { ...envFleet };
  for (const [k, v] of Object.entries(fileFleet)) {
    if (v !== undefined) {
      merged[k] = v;
    }
  }
  const url = merged.baseUrl != null ? String(merged.baseUrl).trim() : '';
  if (fileFleet.provisionEnabled === false || fileFleet.provisionEnabled === 'false') {
    merged.provisionEnabled = false;
  } else if (
    fileFleet.provisionEnabled === true
    || fileFleet.provisionEnabled === 'true'
    || fileFleet.provisionEnabled === 1
  ) {
    merged.provisionEnabled = true;
  } else {
    merged.provisionEnabled = Boolean(envFleet.provisionEnabled) || url.length > 0;
  }
  return merged;
}

/**
 * Effective fleet config for dataNodeSync provisioning (env + file overlay).
 * @param {object} config
 */
function getMergedDataNodeSyncFleet(config) {
  const envFleet = config?.dataNodeSyncFleet && typeof config.dataNodeSyncFleet === 'object'
    ? { ...config.dataNodeSyncFleet }
    : {};
  return mergeDataNodeSyncFleet(envFleet, getFileDataNodeSyncFleet());
}

/**
 * @param {object} config
 * @returns {string|null}
 */
function getEffectiveRaidToRobotSecret(config) {
  const env = config?.robots?.raidToRobotSecret;
  if (env != null && String(env).trim() !== '') {
    return String(env).trim();
  }
  const f = fileData.raidToRobotSecret;
  if (f == null) return null;
  const t = String(f).trim();
  return t || null;
}

/**
 * @param {object} config
 * @returns {string|null}
 */
function getEffectiveFleetEnrollmentSecret(config) {
  const env = config?.robots?.fleetEnrollmentSecret;
  if (env != null && String(env).trim() !== '') {
    return String(env).trim();
  }
  const f = fileData.fleetEnrollmentSecret;
  if (f == null) return null;
  const t = String(f).trim();
  return t || null;
}

/**
 * @param {object} config
 */
function getMergedIncidentRelay(config) {
  const env = config?.dataNodeIncidentRelay && typeof config.dataNodeIncidentRelay === 'object'
    ? { ...config.dataNodeIncidentRelay }
    : {
      enabled: false,
      url: '',
      method: 'POST',
      authHeader: null,
      authValue: null,
    };
  const file = fileData.dataNodeIncidentRelay;
  if (!isPlainObject(file)) {
    return env;
  }
  const merged = { ...env };
  for (const [k, v] of Object.entries(file)) {
    if (v !== undefined) {
      merged[k] = v;
    }
  }
  const url = merged.url != null ? String(merged.url).trim() : '';
  if (file.enabled === false || file.enabled === 'false') {
    merged.enabled = false;
  } else if (file.enabled === true || file.enabled === 'true') {
    merged.enabled = url.length > 0;
  } else {
    const fileTouchedUrl = Object.prototype.hasOwnProperty.call(file, 'url');
    merged.enabled = url.length > 0 && (Boolean(env.enabled) || fileTouchedUrl);
  }
  return merged;
}

/**
 * @param {string} v
 */
function toNumberOrUndef(v) {
  if (v === '' || v === undefined || v === null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Patch fleet file object from admin PUT (only defined keys; authHeaderValue only if key present).
 * @param {Record<string, unknown>} prev
 * @param {unknown} raw
 */
function patchFleetFromBody(prev, raw) {
  if (!isPlainObject(raw)) {
    return { ...prev };
  }
  const next = { ...prev };
  const strOrNull = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const t = String(v).trim();
    return t || null;
  };
  if (raw.baseUrl !== undefined) next.baseUrl = strOrNull(raw.baseUrl);
  if (raw.batchPath !== undefined) next.batchPath = strOrNull(raw.batchPath);
  if (raw.enabled !== undefined) next.enabled = raw.enabled;
  if (raw.intervalSec !== undefined) {
    const n = toNumberOrUndef(raw.intervalSec);
    if (n !== undefined) next.intervalSec = n;
  }
  if (raw.authHeaderName !== undefined) next.authHeaderName = strOrNull(raw.authHeaderName);
  if (Object.prototype.hasOwnProperty.call(raw, 'authHeaderValue')) {
    const av = raw.authHeaderValue;
    if (av === null || av === undefined || String(av).trim() === '' || String(av) === '••••') {
      delete next.authHeaderValue;
    } else {
      next.authHeaderValue = String(av).trim();
    }
  }
  if (raw.provisionEnabled !== undefined) next.provisionEnabled = raw.provisionEnabled;
  for (const k of [
    'includeDashboardEvents',
    'includeAuditEvents',
    'includeStateUsbSnapshot',
    'includeKyrIncidents',
  ]) {
    if (raw[k] !== undefined) next[k] = raw[k];
  }
  return next;
}

/**
 * @param {Record<string, unknown>} prev
 * @param {unknown} raw
 */
function patchIncidentRelayFromBody(prev, raw) {
  if (!isPlainObject(raw)) return { ...prev };
  const next = { ...prev };
  const strOrNull = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const t = String(v).trim();
    return t || null;
  };
  if (raw.url !== undefined) next.url = strOrNull(raw.url);
  if (raw.method !== undefined) next.method = strOrNull(raw.method);
  if (raw.authHeader !== undefined) next.authHeader = strOrNull(raw.authHeader);
  if (Object.prototype.hasOwnProperty.call(raw, 'authValue')) {
    const av = raw.authValue;
    if (av === null || av === undefined || String(av).trim() === '' || String(av) === '••••') {
      delete next.authValue;
    } else {
      next.authValue = String(av).trim();
    }
  }
  if (raw.enabled !== undefined) next.enabled = raw.enabled;
  return next;
}

/**
 * Apply PUT body to fileData and persist.
 * Secret rule: key present + empty string → remove from file; key absent → unchanged; non-empty → store.
 * @param {Record<string, unknown>} body
 */
/**
 * @param {object} config
 * @returns {string} New plaintext secret (persisted to file only).
 */
function rotateFleetEnrollmentSecretInFile(config) {
  const env = config?.robots?.fleetEnrollmentSecret;
  if (env != null && String(env).trim() !== '') {
    const err = new Error(
      'ROBOT_FLEET_ENROLLMENT_SECRET is set in server environment. Update or remove it in .env and restart to change the effective enrollment secret; file-only rotation is disabled while env overrides.',
    );
    err.code = 'SECRET_FROM_ENV';
    throw err;
  }
  const next = randomBytes(32).toString('hex');
  fileData.fleetEnrollmentSecret = next;
  fileData.version = 1;
  persist();
  loadFromDisk();
  return next;
}

/**
 * @param {object} config
 * @returns {string} New plaintext secret (persisted to file only).
 */
function rotateRaidToRobotSecretInFile(config) {
  const env = config?.robots?.raidToRobotSecret;
  if (env != null && String(env).trim() !== '') {
    const err = new Error(
      'RAID_TO_ROBOT_SECRET is set in server environment. Update or remove it in .env and restart to change the effective RAID→robot secret; file-only rotation is disabled while env overrides.',
    );
    err.code = 'SECRET_FROM_ENV';
    throw err;
  }
  const next = randomBytes(32).toString('hex');
  fileData.raidToRobotSecret = next;
  fileData.version = 1;
  persist();
  loadFromDisk();
  return next;
}

function saveFromAdminBody(body) {
  if (!isPlainObject(body)) {
    throw new Error('Body must be a JSON object');
  }

  if (Object.prototype.hasOwnProperty.call(body, 'dataNodeSyncFleet')) {
    if (body.dataNodeSyncFleet === null) {
      delete fileData.dataNodeSyncFleet;
    } else {
      const prev = getFileDataNodeSyncFleet();
      const next = patchFleetFromBody(prev, body.dataNodeSyncFleet);
      if (!Object.keys(next).length) {
        delete fileData.dataNodeSyncFleet;
      } else {
        fileData.dataNodeSyncFleet = next;
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'dataNodeIncidentRelay')) {
    if (body.dataNodeIncidentRelay === null) {
      delete fileData.dataNodeIncidentRelay;
    } else {
      const prev = isPlainObject(fileData.dataNodeIncidentRelay) ? fileData.dataNodeIncidentRelay : {};
      fileData.dataNodeIncidentRelay = patchIncidentRelayFromBody(prev, body.dataNodeIncidentRelay);
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'raidToRobotSecret')) {
    const v = body.raidToRobotSecret;
    if (v === null || v === '') {
      delete fileData.raidToRobotSecret;
    } else if (typeof v === 'string' && String(v) !== '••••') {
      const t = v.trim();
      if (t) fileData.raidToRobotSecret = t;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'fleetEnrollmentSecret')) {
    const v = body.fleetEnrollmentSecret;
    if (v === null || v === '') {
      delete fileData.fleetEnrollmentSecret;
    } else if (typeof v === 'string' && String(v) !== '••••') {
      const t = v.trim();
      if (t) fileData.fleetEnrollmentSecret = t;
    }
  }

  fileData.version = 1;
  persist();
  loadFromDisk();
}

/**
 * Safe GET payload for admin UI (no raw secrets).
 * @param {object} config
 */
function getAdminView(config) {
  const fleetFile = getFileDataNodeSyncFleet();
  const merged = getMergedDataNodeSyncFleet(config);
  const relayFile = isPlainObject(fileData.dataNodeIncidentRelay)
    ? fileData.dataNodeIncidentRelay
    : {};
  const relayMerged = getMergedIncidentRelay(config);

  const authInFile = fleetFile.authHeaderValue != null && String(fleetFile.authHeaderValue).trim() !== '';
  const relayAuthInFile = relayFile.authValue != null && String(relayFile.authValue).trim() !== '';

  return {
    version: fileData.version ?? 1,
    dataNodeSyncFleetFile: { ...fleetFile, authHeaderValue: authInFile ? '••••' : '' },
    dataNodeSyncFleetFileHasAuth: authInFile,
    dataNodeIncidentRelayFile: {
      ...relayFile,
      authValue: relayAuthInFile ? '••••' : '',
    },
    dataNodeIncidentRelayFileHasAuth: relayAuthInFile,
    effectiveDataNodeSyncFleet: {
      ...merged,
      authHeaderValue:
        merged.authHeaderValue != null && String(merged.authHeaderValue).trim() !== ''
          ? '••••'
          : '',
    },
    effectiveIncidentRelay: {
      ...relayMerged,
      authValue:
        relayMerged.authValue != null && String(relayMerged.authValue).trim() !== ''
          ? '••••'
          : '',
    },
    raidToRobotSecretFromEnv: Boolean(config?.robots?.raidToRobotSecret),
    raidToRobotSecretFromFile: Boolean(fileData.raidToRobotSecret),
    fleetEnrollmentSecretFromEnv: Boolean(config?.robots?.fleetEnrollmentSecret),
    fleetEnrollmentSecretFromFile: Boolean(fileData.fleetEnrollmentSecret),
    /** Same value as ROBOT_FLEET_ENROLLMENT_SECRET (env wins over file). Only for authenticated admin GET. */
    fleetEnrollmentSecret: getEffectiveFleetEnrollmentSecret(config),
  };
}

module.exports = {
  init,
  loadFromDisk,
  getMergedDataNodeSyncFleet,
  getEffectiveRaidToRobotSecret,
  getEffectiveFleetEnrollmentSecret,
  getMergedIncidentRelay,
  saveFromAdminBody,
  getAdminView,
  rotateFleetEnrollmentSecretInFile,
  rotateRaidToRobotSecretInFile,
  REG_FILE,
};
