const logger = require('../utils/logger');

function createTeleopOperatorHub() {
  const clients = new Set();

  return {
    add(ws) {
      clients.add(ws);
    },
    remove(ws) {
      clients.delete(ws);
    },
    size() {
      return clients.size;
    },
    /**
     * @param {object} event
     * @param {{ allowedTeleoperatorIds: string[] | null | undefined }} [opts]
     *   `undefined`/`null` — every connected operator socket. A (possibly empty) array — restrict to
     *   those JWT user ids; empty array delivers to nobody (robot has grants but none match).
     */
    broadcastHelpRequest(event, opts = {}) {
      const payload = JSON.stringify(event);
      const raw = opts.allowedTeleoperatorIds;
      /** @type {Set<string> | null} null = no ACL filter */
      let allowSet = null;
      if (raw != null) {
        allowSet = new Set(raw.map((id) => String(id)));
      }

      for (const ws of clients) {
        if (ws.readyState !== 1) {
          continue;
        }
        if (allowSet != null) {
          const tid = ws.teleopUser?.id;
          if (!tid || !allowSet.has(String(tid))) {
            continue;
          }
        }
        try {
          ws.send(payload);
        } catch (error) {
          logger.warn('teleop hub send failed', { error: error.message });
        }
      }
    },
  };
}

module.exports = { createTeleopOperatorHub };
