/**
 * Strip secrets for public API responses.
 * @param {object} robot
 */
function toPublicRobot(robot) {
  if (!robot || typeof robot !== 'object') {
    return robot;
  }
  const { teleopSecret: _t, dataNodeSyncOverride: _d, ...rest } = robot;
  return rest;
}

const REDACTED_TOKEN_PLACEHOLDER = '[redacted]';

/**
 * Admin JSON: hide dataNodeSyncOverride.authHeaderValue (round-trip via placeholder preserves secret).
 * @param {object} robot
 */
/**
 * Strip operator-only fields from robot JSON returned to devices / fleet API (not admin).
 * @param {object} robot
 */
function omitOperatorProvisioningFields(robot) {
  if (!robot || typeof robot !== 'object') {
    return robot;
  }
  const { dataNodeSyncOverride: _d, ...rest } = robot;
  return rest;
}

function redactRobotForAdminApi(robot) {
  if (!robot || typeof robot !== 'object') {
    return robot;
  }
  const r = { ...robot };
  if (
    r.dataNodeSyncOverride != null
    && typeof r.dataNodeSyncOverride === 'object'
    && !Array.isArray(r.dataNodeSyncOverride)
  ) {
    const o = { ...r.dataNodeSyncOverride };
    if (o.authHeaderValue != null && String(o.authHeaderValue).trim() !== '') {
      o.authHeaderValue = REDACTED_TOKEN_PLACEHOLDER;
    }
    r.dataNodeSyncOverride = o;
  }
  return r;
}

/**
 * @param {unknown} v
 * @returns {object|null}
 */
function parseJsonbColumn(v) {
  if (v == null) {
    return null;
  }
  if (typeof v === 'object' && !Array.isArray(v)) {
    return v;
  }
  try {
    const o = JSON.parse(String(v));
    return typeof o === 'object' && o !== null && !Array.isArray(o) ? o : null;
  } catch {
    return null;
  }
}

/**
 * @param {import('pg').Pool} pool
 */
function createRobotRepository(pool) {
  const robotColumns = `id, name, host, port, requires_x402, rosbridge_host, rosbridge_port, teleop_secret,
                enrollment_key, operator_registry_url, dataset_http_host, dataset_http_port, data_node_sync_override`;

  return {
    /**
     * @returns {Promise<Array<import('pg').QueryResultRow>>}
     */
    async listAll() {
      const r = await pool.query(`SELECT ${robotColumns} FROM robots ORDER BY created_at ASC`);
      return r.rows;
    },

    /**
     * @param {string} enrollmentKey
     * @returns {Promise<import('pg').QueryResultRow|null>}
     */
    async findByEnrollmentKey(enrollmentKey) {
      const r = await pool.query(`SELECT ${robotColumns} FROM robots WHERE enrollment_key = $1 LIMIT 1`, [
        enrollmentKey,
      ]);
      return r.rows[0] || null;
    },

    /**
     * @param {object} robot
     */
    async insert(robot) {
      const dno =
        robot.dataNodeSyncOverride != null && typeof robot.dataNodeSyncOverride === 'object'
          ? robot.dataNodeSyncOverride
          : null;
      await pool.query(
        `INSERT INTO robots (id, name, host, port, requires_x402, rosbridge_host, rosbridge_port, teleop_secret,
                            enrollment_key, operator_registry_url, dataset_http_host, dataset_http_port,
                            data_node_sync_override)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          robot.id,
          robot.name,
          robot.host,
          robot.port,
          Boolean(robot.requiresX402),
          robot.rosbridgeHost,
          robot.rosbridgePort,
          robot.teleopSecret,
          robot.enrollmentKey != null && robot.enrollmentKey !== '' ? String(robot.enrollmentKey) : null,
          robot.operatorRegistryUrl != null && robot.operatorRegistryUrl !== ''
            ? String(robot.operatorRegistryUrl)
            : null,
          robot.datasetHttpHost != null && String(robot.datasetHttpHost).trim() !== ''
            ? String(robot.datasetHttpHost).trim()
            : null,
          robot.datasetHttpPort != null && !Number.isNaN(Number(robot.datasetHttpPort))
            ? Number(robot.datasetHttpPort)
            : null,
          dno,
        ],
      );
    },

    /**
     * @param {object} robot merged static fields
     */
    async updateStatic(robot) {
      const dno =
        robot.dataNodeSyncOverride != null && typeof robot.dataNodeSyncOverride === 'object'
          ? robot.dataNodeSyncOverride
          : null;
      await pool.query(
        `UPDATE robots SET
           name = $2,
           host = $3,
           port = $4,
           requires_x402 = $5,
           rosbridge_host = $6,
           rosbridge_port = $7,
           teleop_secret = $8,
           enrollment_key = $9,
           operator_registry_url = $10,
           dataset_http_host = $11,
           dataset_http_port = $12,
           data_node_sync_override = $13,
           updated_at = NOW()
         WHERE id = $1`,
        [
          robot.id,
          robot.name,
          robot.host,
          robot.port,
          Boolean(robot.requiresX402),
          robot.rosbridgeHost,
          robot.rosbridgePort,
          robot.teleopSecret,
          robot.enrollmentKey != null && robot.enrollmentKey !== '' ? String(robot.enrollmentKey) : null,
          robot.operatorRegistryUrl != null && robot.operatorRegistryUrl !== ''
            ? String(robot.operatorRegistryUrl)
            : null,
          robot.datasetHttpHost != null && String(robot.datasetHttpHost).trim() !== ''
            ? String(robot.datasetHttpHost).trim()
            : null,
          robot.datasetHttpPort != null && !Number.isNaN(Number(robot.datasetHttpPort))
            ? Number(robot.datasetHttpPort)
            : null,
          dno,
        ],
      );
    },

    /**
     * @param {string} robotId
     */
    async deleteById(robotId) {
      const r = await pool.query('DELETE FROM robots WHERE id = $1', [robotId]);
      return r.rowCount > 0;
    },
  };
}

/**
 * @param {import('pg').QueryResultRow} row
 */
function rowToRobot(row) {
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    requiresX402: row.requires_x402,
    rosbridgeHost: row.rosbridge_host,
    rosbridgePort: row.rosbridge_port,
    teleopSecret: row.teleop_secret != null ? String(row.teleop_secret) : null,
    enrollmentKey: row.enrollment_key != null ? String(row.enrollment_key) : null,
    operatorRegistryUrl:
      row.operator_registry_url != null ? String(row.operator_registry_url) : null,
    datasetHttpHost:
      row.dataset_http_host != null && String(row.dataset_http_host).trim() !== ''
        ? String(row.dataset_http_host).trim()
        : null,
    datasetHttpPort:
      row.dataset_http_port != null && !Number.isNaN(Number(row.dataset_http_port))
        ? Number(row.dataset_http_port)
        : null,
    dataNodeSyncOverride: parseJsonbColumn(row.data_node_sync_override),
    status: {
      state: 'unknown',
      message: 'Awaiting health check',
      availableMethods: [],
      secure: false,
    },
    lastHealthCheckAt: null,
    location: null,
  };
}

module.exports = {
  createRobotRepository,
  rowToRobot,
  toPublicRobot,
  omitOperatorProvisioningFields,
  redactRobotForAdminApi,
  REDACTED_TOKEN_PLACEHOLDER,
};
