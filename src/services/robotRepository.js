/**
 * Strip secrets for public API responses.
 * @param {object} robot
 */
function toPublicRobot(robot) {
  if (!robot || typeof robot !== 'object') {
    return robot;
  }
  const { teleopSecret: _t, ...rest } = robot;
  return rest;
}

/**
 * @param {import('pg').Pool} pool
 */
function createRobotRepository(pool) {
  return {
    /**
     * @returns {Promise<Array<import('pg').QueryResultRow>>}
     */
    async listAll() {
      const r = await pool.query(
        `SELECT id, name, host, port, requires_x402, rosbridge_host, rosbridge_port, teleop_secret,
                enrollment_key, operator_registry_url, dataset_http_host, dataset_http_port
         FROM robots ORDER BY created_at ASC`,
      );
      return r.rows;
    },

    /**
     * @param {string} enrollmentKey
     * @returns {Promise<import('pg').QueryResultRow|null>}
     */
    async findByEnrollmentKey(enrollmentKey) {
      const r = await pool.query(
        `SELECT id, name, host, port, requires_x402, rosbridge_host, rosbridge_port, teleop_secret,
                enrollment_key, operator_registry_url, dataset_http_host, dataset_http_port
         FROM robots WHERE enrollment_key = $1 LIMIT 1`,
        [enrollmentKey],
      );
      return r.rows[0] || null;
    },

    /**
     * @param {object} robot
     */
    async insert(robot) {
      await pool.query(
        `INSERT INTO robots (id, name, host, port, requires_x402, rosbridge_host, rosbridge_port, teleop_secret,
                            enrollment_key, operator_registry_url, dataset_http_host, dataset_http_port)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
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
        ],
      );
    },

    /**
     * @param {object} robot merged static fields
     */
    async updateStatic(robot) {
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

module.exports = { createRobotRepository, rowToRobot, toPublicRobot };
