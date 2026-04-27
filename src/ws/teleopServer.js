const WebSocketLib = require('ws');
const WebSocket = WebSocketLib;
const WebSocketServer = WebSocketLib.WebSocketServer || WebSocketLib.Server;
const logger = require('../utils/logger');
const { verifyTeleopToken } = require('../middleware/teleopSession');
const {
  getActiveSessionForOperator,
  endTeleopSession,
} = require('../services/teleopHelpRepository');

/**
 * Client WS URL/options toward rosbridge on the robot: teleoperator identity (JWT sub + login).
 * The robot may read headers on proxy/nginx or query params (if the stack exposes them to the app).
 *
 * @param {{ rosHost: string, rosPort: number, user: { id: string, login?: string }, teleopCfg: { forwardOperatorHeaders?: boolean, forwardOperatorQuery?: boolean } }} p
 * @returns {{ url: string, wsOptions: { headers: Record<string, string> } | null }}
 */
function buildRosbridgeWebSocketTarget({ rosHost, rosPort, user, teleopCfg }) {
  let url = `ws://${rosHost}:${rosPort}`;
  const forwardH = teleopCfg?.forwardOperatorHeaders !== false;
  const forwardQ = teleopCfg?.forwardOperatorQuery !== false;

  /** @type {Record<string, string>} */
  const headers = {};
  if (forwardH) {
    headers['X-Teleoperator-Id'] = String(user.id);
    if (user.login) {
      headers['X-Teleoperator-Login'] = String(user.login);
    }
  }

  if (forwardQ) {
    const params = new URLSearchParams();
    params.set('teleoperator_id', String(user.id));
    if (user.login) {
      params.set('teleoperator_login', String(user.login));
    }
    const qs = params.toString();
    url += url.includes('?') ? `&${qs}` : `?${qs}`;
  }

  const wsOptions = forwardH && Object.keys(headers).length > 0 ? { headers } : null;
  return { url, wsOptions };
}

/**
 * Single attempt to open outbound WS to rosbridge (until open, timeout, or error).
 * @param {string} rosUrl
 * @param {import('ws').ClientOptions | null} wsOptions
 * @param {number} connectTimeoutMs
 * @returns {Promise<import('ws').WebSocket>}
 */
function openRosbridgeOnce(rosUrl, wsOptions, connectTimeoutMs) {
  return new Promise((resolve, reject) => {
    let sock;
    try {
      sock = wsOptions ? new WebSocket(rosUrl, wsOptions) : new WebSocket(rosUrl);
    } catch (error) {
      reject(error);
      return;
    }
    const timeout = setTimeout(() => {
      try {
        sock.close();
      } catch {
        /* ignore */
      }
      reject(new Error('Rosbridge connect timeout'));
    }, connectTimeoutMs);

    const done = (err) => {
      clearTimeout(timeout);
      if (err) {
        try {
          sock.close();
        } catch {
          /* ignore */
        }
        reject(err);
      } else {
        resolve(sock);
      }
    };

    sock.once('open', () => done(null));
    sock.once('error', (err) => done(err || new Error('Rosbridge error')));
  });
}

/**
 * Multiple rosbridge connect attempts with delay between tries.
 */
async function openRosbridgeWithRetries(rosUrl, wsOptions, connectTimeoutMs, attempts, delayMs) {
  let lastErr = new Error('Rosbridge connect failed');
  for (let i = 0; i < attempts; i += 1) {
    if (i > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
    try {
      return await openRosbridgeOnce(rosUrl, wsOptions, connectTimeoutMs);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

/**
 * @param {import('http').Server} httpServer
 * @param {{ config: object, pool: import('pg').Pool, registry: object, teleopHub: object }} deps
 */
function attachTeleopWebSockets(httpServer, deps) {
  const { config, pool, registry, teleopHub } = deps;
  const teleopCfg = config.teleop;

  if (!teleopCfg?.enabled) {
    logger.info('Teleop WebSocket server disabled (TELEOP_WS_ENABLED=false)');
    return;
  }

  const wss = new WebSocketServer({ noServer: true });
  const reservedProxySessions = new Set();
  /** @type {Map<string, ReturnType<typeof setTimeout>>} */
  const sessionGraceTimers = new Map();

  function clearSessionGraceTimer(sessionId) {
    const t = sessionGraceTimers.get(sessionId);
    if (t) {
      clearTimeout(t);
      sessionGraceTimers.delete(sessionId);
    }
  }

  function scheduleSessionGraceEnd(sessionId, graceMs) {
    clearSessionGraceTimer(sessionId);
    const timer = setTimeout(() => {
      sessionGraceTimers.delete(sessionId);
      endTeleopSession(pool, sessionId).catch((error) => {
        logger.error('endTeleopSession (grace) failed', { error: error.message, sessionId });
      });
    }, graceMs);
    sessionGraceTimers.set(sessionId, timer);
  }

  httpServer.on('upgrade', (request, socket, head) => {
    const host = request.headers.host || 'localhost';
    let url;
    try {
      url = new URL(request.url, `http://${host}`);
    } catch {
      socket.destroy();
      return;
    }

    const { pathname, searchParams } = url;
    const token = searchParams.get('token');

    if (pathname === '/ws/teleoperator') {
      if (!token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      const user = verifyTeleopToken(token, config.teleoperator);
      if (!user) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        ws.teleopUser = user;
        teleopHub.add(ws);
        ws.on('close', () => teleopHub.remove(ws));
        ws.on('error', () => teleopHub.remove(ws));
      });
      return;
    }

    const m = pathname.match(/^\/ws\/teleop\/session\/([^/]+)$/);
    if (m) {
      const sessionId = m[1];
      if (!token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      const user = verifyTeleopToken(token, config.teleoperator);
      if (!user) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        handleProxySession(ws, {
          sessionId,
          user,
          pool,
          registry,
          teleopCfg,
          reservedProxySessions,
          clearSessionGraceTimer,
          scheduleSessionGraceEnd,
        });
      });
      return;
    }

    socket.destroy();
  });

  logger.info('Teleop WebSocket upgrade handler attached', {
    paths: ['/ws/teleoperator', '/ws/teleop/session/:sessionId'],
    sessionEndGraceMs: teleopCfg.sessionEndGraceMs,
    rosbridgeConnectAttempts: teleopCfg.rosbridgeConnectAttempts,
    rosbridgeDropReconnectAttempts: teleopCfg.rosbridgeDropReconnectAttempts,
  });
}

function handleProxySession(ws, ctx) {
  const {
    sessionId,
    user,
    pool,
    registry,
    teleopCfg,
    reservedProxySessions,
    clearSessionGraceTimer,
    scheduleSessionGraceEnd,
  } = ctx;

  const maxBytes = teleopCfg.maxMessageBytes;
  const connectTimeout = teleopCfg.rosbridgeConnectTimeoutMs;
  const connectAttempts = teleopCfg.rosbridgeConnectAttempts;
  const retryDelay = teleopCfg.rosbridgeReconnectDelayMs;
  const dropWaves = teleopCfg.rosbridgeDropReconnectAttempts;
  const graceMs = teleopCfg.sessionEndGraceMs;

  let cleaned = false;
  let robotWs = null;
  let bridgeEverOpened = false;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let reconnectTimer = null;

  const physicalCleanup = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    reservedProxySessions.delete(sessionId);
    if (robotWs) {
      try {
        robotWs.removeAllListeners();
        robotWs.close();
      } catch {
        /* ignore */
      }
      robotWs = null;
    }
  };

  /**
   * @param {{ immediateEndDb?: boolean, closeClient?: boolean, closeCode?: number, closeReason?: string }} opts
   */
  const finalizeSession = (opts = {}) => {
    const {
      immediateEndDb = false,
      closeClient = false,
      closeCode = 1011,
      closeReason = 'Session ended',
    } = opts;
    if (cleaned) {
      return;
    }
    cleaned = true;
    physicalCleanup();
    const endNow = immediateEndDb || graceMs <= 0;
    if (endNow) {
      clearSessionGraceTimer(sessionId);
      endTeleopSession(pool, sessionId).catch((error) => {
        logger.error('endTeleopSession failed', { error: error.message, sessionId });
      });
    } else {
      scheduleSessionGraceEnd(sessionId, graceMs);
    }
    if (closeClient && ws.readyState === WebSocket.OPEN) {
      try {
        ws.close(closeCode, closeReason);
      } catch {
        /* ignore */
      }
    }
  };

  async function establishRobotLink() {
    return openRosbridgeWithRetries(
      rosUrl,
      wsOptions,
      connectTimeout,
      connectAttempts,
      retryDelay,
    );
  }

  let rosUrl = '';
  /** @type {import('ws').ClientOptions | null} */
  let wsOptions = null;

  (async () => {
    const row = await getActiveSessionForOperator(pool, {
      sessionId,
      teleoperatorId: user.id,
    });
    if (!row) {
      ws.close(4404, 'Session not found or ended');
      return;
    }

    if (reservedProxySessions.has(sessionId)) {
      ws.close(4409, 'Session already has an active connection');
      return;
    }
    reservedProxySessions.add(sessionId);
    clearSessionGraceTimer(sessionId);

    const robot = registry.getById(row.robot_id);
    if (!robot) {
      reservedProxySessions.delete(sessionId);
      ws.close(4503, 'Robot not in registry');
      return;
    }

    const rosHost = robot.rosbridgeHost || robot.host;
    const rosPort = robot.rosbridgePort != null ? robot.rosbridgePort : 9090;
    const built = buildRosbridgeWebSocketTarget({
      rosHost,
      rosPort,
      user,
      teleopCfg,
    });
    rosUrl = built.url;
    wsOptions = built.wsOptions;

    /** Remaining rosbridge reconnect waves after a drop (reset to dropWaves after a successful open). */
    let reconnectAttemptsLeft = 0;

    const onRobotSideDead = () => {
      if (cleaned) {
        return;
      }
      if (robotWs) {
        try {
          robotWs.removeAllListeners();
        } catch {
          /* ignore */
        }
        try {
          robotWs.close();
        } catch {
          /* ignore */
        }
        robotWs = null;
      }
      if (ws.readyState !== WebSocket.OPEN) {
        finalizeSession({ immediateEndDb: !bridgeEverOpened });
        return;
      }
      if (reconnectAttemptsLeft <= 0) {
        finalizeSession({
          immediateEndDb: !bridgeEverOpened,
          closeClient: true,
          closeCode: 1011,
          closeReason: 'Rosbridge error',
        });
        return;
      }
      reconnectAttemptsLeft -= 1;
      logger.info('rosbridge reconnect scheduled', { sessionId, reconnectAttemptsLeft });
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        runReconnectWave().catch((error) => {
          logger.error('runReconnectWave failed', { error: error.message, sessionId });
          finalizeSession({
            immediateEndDb: !bridgeEverOpened,
            closeClient: true,
            closeCode: 1011,
            closeReason: 'Rosbridge error',
          });
        });
      }, retryDelay);
    };

    const wireDuplex = () => {
      if (!robotWs || cleaned) {
        return;
      }
      let deadOnce = false;
      const onDead = (err) => {
        if (deadOnce) {
          return;
        }
        deadOnce = true;
        if (err) {
          logger.warn('robot bridge socket error', { error: err.message, sessionId });
        }
        try {
          robotWs.removeAllListeners();
        } catch {
          /* ignore */
        }
        try {
          robotWs.close();
        } catch {
          /* ignore */
        }
        robotWs = null;
        onRobotSideDead();
      };

      robotWs.on('message', (data, isBinary) => {
        if (ws.readyState !== WebSocket.OPEN) {
          return;
        }
        const len = typeof data === 'string' ? Buffer.byteLength(data) : data.length;
        if (len > maxBytes) {
          return;
        }
        try {
          ws.send(data, { binary: isBinary });
        } catch {
          /* ignore */
        }
      });

      robotWs.once('error', (err) => onDead(err));
      robotWs.once('close', () => onDead(null));
    };

    async function runReconnectWave() {
      if (cleaned || ws.readyState !== WebSocket.OPEN) {
        return;
      }
      try {
        robotWs = await establishRobotLink();
        bridgeEverOpened = true;
        reconnectAttemptsLeft = dropWaves;
        wireDuplex();
      } catch (error) {
        logger.warn('rosbridge reconnect wave failed', { sessionId, message: error.message });
        onRobotSideDead();
      }
    }

    try {
      robotWs = await establishRobotLink();
    } catch (error) {
      logger.warn('rosbridge initial connect failed', { sessionId, message: error.message });
      reservedProxySessions.delete(sessionId);
      cleaned = true;
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1011, 'Rosbridge unreachable');
      }
      clearSessionGraceTimer(sessionId);
      endTeleopSession(pool, sessionId).catch((e) => {
        logger.error('endTeleopSession failed', { error: e.message, sessionId });
      });
      return;
    }

    bridgeEverOpened = true;
    reconnectAttemptsLeft = dropWaves;
    wireDuplex();

    ws.on('message', (data, isBinary) => {
      if (!robotWs || robotWs.readyState !== WebSocket.OPEN) {
        return;
      }
      const len = typeof data === 'string' ? Buffer.byteLength(data) : data.length;
      if (len > maxBytes) {
        return;
      }
      try {
        robotWs.send(data, { binary: isBinary });
      } catch {
        /* ignore */
      }
    });

    ws.on('close', () => {
      finalizeSession({ immediateEndDb: !bridgeEverOpened });
    });

    ws.on('error', () => {
      finalizeSession({ immediateEndDb: !bridgeEverOpened });
    });
  })().catch((error) => {
    logger.error('proxy session setup failed', { error: error.message, sessionId });
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1011, 'Internal error');
    }
    finalizeSession({ immediateEndDb: true });
  });
}

module.exports = {
  attachTeleopWebSockets,
  buildRosbridgeWebSocketTarget,
  openRosbridgeOnce,
  openRosbridgeWithRetries,
};
