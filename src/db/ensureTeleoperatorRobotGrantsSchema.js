/**
 * Which teleoperators may accept teleop sessions for which robots (RAID-side ACL).
 * @param {import('pg').Pool} pool
 */
async function ensureTeleoperatorRobotGrantsSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS teleoperator_robot_grants (
      teleoperator_id UUID NOT NULL REFERENCES teleoperators(id) ON DELETE CASCADE,
      robot_id UUID NOT NULL REFERENCES robots(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at TIMESTAMPTZ,
      PRIMARY KEY (teleoperator_id, robot_id)
    );
  `);
}

module.exports = { ensureTeleoperatorRobotGrantsSchema };
