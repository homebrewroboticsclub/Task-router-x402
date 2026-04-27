/**
 * @param {import('pg').Pool} pool
 */
function createTeleoperatorRobotGrantRepository(pool) {
  return {
    /**
     * @param {{ teleoperatorId: string, robotId: string }} p
     */
    async hasActiveGrant(p) {
      const r = await pool.query(
        `SELECT 1 FROM teleoperator_robot_grants
         WHERE teleoperator_id = $1 AND robot_id = $2 AND revoked_at IS NULL
         LIMIT 1`,
        [p.teleoperatorId, p.robotId],
      );
      return r.rowCount > 0;
    },

    /** When zero, any operator may accept (backward compatible); when >0, ACL applies. */
    async countActiveGrantsForRobot(robotId) {
      const r = await pool.query(
        `SELECT COUNT(*)::int AS c FROM teleoperator_robot_grants
         WHERE robot_id = $1 AND revoked_at IS NULL`,
        [robotId],
      );
      return r.rows[0]?.c ?? 0;
    },

    async listActive() {
      const r = await pool.query(
        `SELECT g.teleoperator_id, g.robot_id, g.created_at,
                t.login_normalized AS teleoperator_login
         FROM teleoperator_robot_grants g
         JOIN teleoperators t ON t.id = g.teleoperator_id
         WHERE g.revoked_at IS NULL
         ORDER BY g.created_at ASC`,
      );
      return r.rows;
    },

    /**
     * @param {{ teleoperatorId: string, robotId: string }} p
     */
    async grant(p) {
      const r = await pool.query(
        `INSERT INTO teleoperator_robot_grants (teleoperator_id, robot_id)
         VALUES ($1, $2)
         ON CONFLICT (teleoperator_id, robot_id)
         DO UPDATE SET revoked_at = NULL
         RETURNING teleoperator_id, robot_id, created_at, revoked_at`,
        [p.teleoperatorId, p.robotId],
      );
      return r.rows[0];
    },

    /**
     * @param {{ teleoperatorId: string, robotId: string }} p
     */
    async revoke(p) {
      const r = await pool.query(
        `UPDATE teleoperator_robot_grants
         SET revoked_at = NOW()
         WHERE teleoperator_id = $1 AND robot_id = $2 AND revoked_at IS NULL`,
        [p.teleoperatorId, p.robotId],
      );
      return r.rowCount > 0;
    },

    /** @param {string} robotId */
    async listActiveTeleoperatorIdsForRobot(robotId) {
      const r = await pool.query(
        `SELECT teleoperator_id FROM teleoperator_robot_grants
         WHERE robot_id = $1 AND revoked_at IS NULL`,
        [robotId],
      );
      return r.rows.map((row) => String(row.teleoperator_id));
    },
  };
}

module.exports = { createTeleoperatorRobotGrantRepository };
