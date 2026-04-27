const logger = require('./logger');

/** Max UTF-8 bytes for `metadata.situation_report` (spec: ~32–64 KiB). */
const MAX_SITUATION_REPORT_BYTES = 65536;

/** Max UTF-8 bytes for serialized `metadata.kyr_peaq_context` and stored `peaq_claim` (RAID_APP_PEAQ_CLAIM_SPEC §6). */
const MAX_KYR_PEAQ_CONTEXT_BYTES = 65536;
const MAX_PEAQ_CLAIM_JSON_BYTES = 65536;

class KyrPeaqContextInvalidError extends Error {
  constructor(message = 'metadata.kyr_peaq_context must be a plain object when provided') {
    super(message);
    this.name = 'KyrPeaqContextInvalidError';
    this.httpStatus = 400;
  }
}

class KyrPeaqContextTooLargeError extends Error {
  constructor() {
    super('metadata.kyr_peaq_context exceeds maximum JSON size (64 KiB)');
    this.name = 'KyrPeaqContextTooLargeError';
    this.httpStatus = 413;
  }
}

/**
 * @param {unknown} v
 * @returns {boolean}
 */
function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * UTF-8 byte length of JSON.stringify(value).
 * @param {unknown} value
 * @returns {number}
 */
function jsonUtf8ByteLength(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

/**
 * @param {Record<string, unknown>} metadata - raw metadata object (before normalization)
 */
function assertKyrPeaqContextSize(metadata) {
  if (!Object.prototype.hasOwnProperty.call(metadata, 'kyr_peaq_context')) {
    return;
  }
  const ctx = metadata.kyr_peaq_context;
  if (ctx == null) {
    return;
  }
  if (!isPlainObject(ctx)) {
    throw new KyrPeaqContextInvalidError();
  }
  if (jsonUtf8ByteLength(ctx) > MAX_KYR_PEAQ_CONTEXT_BYTES) {
    throw new KyrPeaqContextTooLargeError();
  }
}

/**
 * Ensure `peaq_claim` JSON fits §6 size cap (drops `raw`, then shrinks `document`).
 * @param {Record<string, unknown>} claim
 * @param {number} [maxBytes]
 * @returns {Record<string, unknown>}
 */
function truncatePeaqClaimJson(claim, maxBytes = MAX_PEAQ_CLAIM_JSON_BYTES) {
  if (!isPlainObject(claim)) {
    return claim;
  }
  if (jsonUtf8ByteLength(claim) <= maxBytes) {
    return claim;
  }
  const base = {
    schema_version: claim.schema_version,
    network: claim.network,
    help_request_id: claim.help_request_id,
    robot_id: claim.robot_id,
    issued_at_unix: claim.issued_at_unix,
    document: claim.document,
    raw: {},
  };
  if (claim.raid_peaq_read_status != null) {
    base.raid_peaq_read_status = claim.raid_peaq_read_status;
  }
  if (claim.raid_peaq_error != null) {
    base.raid_peaq_error = claim.raid_peaq_error;
  }
  if (jsonUtf8ByteLength(base) <= maxBytes) {
    return base;
  }
  const doc =
    isPlainObject(claim.document) && claim.document
      ? {
          id: claim.document.id,
          controller: claim.document.controller,
        }
      : {};
  const minimal = { ...base, document: doc };
  if (jsonUtf8ByteLength(minimal) <= maxBytes) {
    return minimal;
  }
  return { ...minimal, document: {} };
}

/**
 * Truncate a string so its UTF-8 byte length is at most `maxBytes`, without splitting a code point.
 * @param {string} str
 * @param {number} maxBytes
 * @returns {string}
 */
function truncateUtf8(str, maxBytes) {
  const buf = Buffer.from(str, 'utf8');
  if (buf.length <= maxBytes) {
    return str;
  }
  let len = maxBytes;
  // Drop trailing bytes that would split a code point (first excluded byte is UTF-8 continuation).
  while (len > 0 && len < buf.length && (buf[len] & 0xc0) === 0x80) {
    len -= 1;
  }
  return buf.subarray(0, len).toString('utf8');
}

/**
 * @param {unknown} v
 * @returns {string}
 */
function coerceMetadataString(v) {
  if (typeof v === 'string') {
    return v;
  }
  if (v != null && (typeof v === 'number' || typeof v === 'boolean')) {
    return String(v);
  }
  return '';
}

/**
 * Normalize robot POST …/teleop/help body per docs/RAID_APP_TELEOP_HELP_SPEC.md.
 * `message` must be a string (caller validates).
 * Missing `metadata` or keys → empty strings; extra keys preserved under `metadata`.
 * `situation_report` truncated at MAX_SITUATION_REPORT_BYTES UTF-8 with a warning log.
 *
 * @param {object} body - parsed JSON object
 * @returns {{ message: string, metadata: Record<string, unknown> }}
 */
function normalizeRobotTeleopHelpBody(body) {
  const message = body.message;
  const rawMeta =
    body.metadata != null && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
      ? { ...body.metadata }
      : {};

  assertKyrPeaqContextSize(rawMeta);

  const task_id = coerceMetadataString(rawMeta.task_id);
  const error_context = coerceMetadataString(rawMeta.error_context);
  let situation_report = coerceMetadataString(rawMeta.situation_report);

  delete rawMeta.task_id;
  delete rawMeta.error_context;
  delete rawMeta.situation_report;

  const srBytes = Buffer.byteLength(situation_report, 'utf8');
  if (srBytes > MAX_SITUATION_REPORT_BYTES) {
    logger.warn('metadata.situation_report truncated to max UTF-8 length', {
      byteLength: srBytes,
      maxBytes: MAX_SITUATION_REPORT_BYTES,
    });
    situation_report = truncateUtf8(situation_report, MAX_SITUATION_REPORT_BYTES);
  }

  return {
    message,
    metadata: {
      ...rawMeta,
      task_id,
      error_context,
      situation_report,
    },
  };
}

module.exports = {
  MAX_SITUATION_REPORT_BYTES,
  MAX_KYR_PEAQ_CONTEXT_BYTES,
  MAX_PEAQ_CLAIM_JSON_BYTES,
  KyrPeaqContextInvalidError,
  KyrPeaqContextTooLargeError,
  normalizeRobotTeleopHelpBody,
  truncateUtf8,
  truncatePeaqClaimJson,
  jsonUtf8ByteLength,
};
