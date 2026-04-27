/**
 * Stable operator_end_reason values stored on teleop_sessions (HTTP-driven ends).
 * @readonly
 */
const TELEOP_OPERATOR_END_REASON = {
  /** Decline after brief, before /ws/teleop/session WebSocket (task reopened). */
  BRIEF_DECLINED_BEFORE_PROXY: 'brief_declined_before_proxy',
  /** Normal task completion from headset UI. */
  GRACEFUL_COMPLETE: 'graceful_complete',
  /** Operator backs out during an active proxied session. */
  OPERATOR_CANCELLED: 'operator_cancelled',
  /** Link quality / latency abort. */
  NETWORK_QUALITY_ABORT: 'network_quality_abort',
  /** Client-side error / fault. */
  CLIENT_ERROR: 'client_error',
};

/** Reasons allowed for POST /api/teleoperator/sessions/:id/end (after proxy connected). */
const TELEOP_SESSION_END_REASONS = new Set([
  TELEOP_OPERATOR_END_REASON.GRACEFUL_COMPLETE,
  TELEOP_OPERATOR_END_REASON.OPERATOR_CANCELLED,
  TELEOP_OPERATOR_END_REASON.NETWORK_QUALITY_ABORT,
  TELEOP_OPERATOR_END_REASON.CLIENT_ERROR,
]);

/**
 * @param {unknown} reason
 * @returns {reason is string}
 */
function isValidSessionEndReason(reason) {
  return typeof reason === 'string' && TELEOP_SESSION_END_REASONS.has(reason);
}

module.exports = {
  TELEOP_OPERATOR_END_REASON,
  TELEOP_SESSION_END_REASONS,
  isValidSessionEndReason,
};
