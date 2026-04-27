const { Sdk } = require('@peaq-network/sdk');
const logger = require('../utils/logger');
const { truncatePeaqClaimJson } = require('../utils/teleopHelpPayload');

/**
 * @param {unknown} obj
 * @returns {unknown}
 */
function jsonSafeClone(obj) {
  if (obj === undefined || obj === null) {
    return obj;
  }
  try {
    return JSON.parse(
      JSON.stringify(obj, (_key, value) => (typeof value === 'bigint' ? value.toString() : value)),
    );
  } catch (e) {
    logger.warn('peaq claim JSON clone failed, using empty object', { error: e.message });
    return {};
  }
}

/** @param {object} peaqConfig - `config.peaq` from loadConfig */
function createPeaqClaimService(peaqConfig) {
  const cfg = peaqConfig || {};

  function isEnabled() {
    if (!cfg.enabled) {
      return false;
    }
    const h = String(cfg.httpBaseUrl || '').trim();
    const w = String(cfg.wssBaseUrl || '').trim();
    const n = String(cfg.machineDidName || '').trim();
    const a = String(cfg.machineEvmAddress || '').trim();
    return Boolean(h && w && n && a);
  }

  /**
   * Persisted when `did.read` throws: help POST still succeeds; GET …/peaq/claim returns this instead of endless 404.
   * @param {{ helpRequestId: string, robotId: string, errorMessage?: string }} input
   * @returns {Record<string, unknown>}
   */
  function buildFailureClaim({ helpRequestId, robotId, errorMessage }) {
    const msg = String(errorMessage || 'peaq did.read failed').slice(0, 500);
    const issuedAtUnix = Math.floor(Date.now() / 1000);
    return truncatePeaqClaimJson({
      schema_version: 1,
      network: cfg.networkLabel || 'peaq-agung',
      help_request_id: helpRequestId,
      robot_id: robotId,
      issued_at_unix: issuedAtUnix,
      document: {},
      raw: {},
      raid_peaq_read_status: 'failed',
      raid_peaq_error: msg,
    });
  }

  /**
   * @param {{ helpRequestId: string, robotId: string }} input
   * @returns {Promise<Record<string, unknown>>}
   */
  async function buildClaim({ helpRequestId, robotId }) {
    if (!isEnabled()) {
      throw new Error('Peaq claim is not configured');
    }
    let sdk;
    try {
      sdk = await Sdk.createInstance({
        baseUrl: cfg.httpBaseUrl,
        chainType: Sdk.ChainType.EVM,
      });
      const readResult = await sdk.did.read({
        name: cfg.machineDidName,
        address: cfg.machineEvmAddress,
        wssBaseUrl: cfg.wssBaseUrl,
      });
      const raw = jsonSafeClone(readResult);
      const document =
        readResult && readResult.document != null ? jsonSafeClone(readResult.document) : {};
      const issuedAtUnix = Math.floor(Date.now() / 1000);
      return truncatePeaqClaimJson({
        schema_version: 1,
        network: cfg.networkLabel || 'peaq-agung',
        help_request_id: helpRequestId,
        robot_id: robotId,
        issued_at_unix: issuedAtUnix,
        document,
        raw,
      });
    } finally {
      if (sdk && typeof sdk.disconnect === 'function') {
        try {
          await sdk.disconnect();
        } catch (e) {
          /* EVM path often has no substrate connection */
        }
      }
    }
  }

  return { isEnabled, buildClaim, buildFailureClaim };
}

module.exports = { createPeaqClaimService };
