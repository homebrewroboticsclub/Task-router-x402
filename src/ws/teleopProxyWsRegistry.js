/** @type {Map<string, import('ws')>} */
const operatorSocketsBySessionId = new Map();

/**
 * @param {string} sessionId
 * @param {import('ws')} ws
 */
function registerProxyOperatorSocket(sessionId, ws) {
  operatorSocketsBySessionId.set(String(sessionId), ws);
}

/**
 * @param {string} sessionId
 */
function unregisterProxyOperatorSocket(sessionId) {
  operatorSocketsBySessionId.delete(String(sessionId));
}

/**
 * Close operator proxy WebSocket if still open (e.g. HTTP POST .../end).
 * Sets ws.skipTeleopEndGrace so the close handler ends the DB session immediately without grace.
 * @param {string} sessionId
 * @returns {boolean} true if a socket was closed
 */
function closeProxyOperatorWebSocket(sessionId) {
  const WebSocketLib = require('ws');
  const OPEN = WebSocketLib.OPEN ?? 1;
  const ws = operatorSocketsBySessionId.get(String(sessionId));
  if (!ws) {
    return false;
  }
  operatorSocketsBySessionId.delete(String(sessionId));
  try {
    ws.skipTeleopEndGrace = true;
    if (ws.readyState === OPEN) {
      ws.close(4400, 'Session ended by operator');
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

module.exports = {
  registerProxyOperatorSocket,
  unregisterProxyOperatorSocket,
  closeProxyOperatorWebSocket,
};
