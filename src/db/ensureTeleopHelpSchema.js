/**
 * Idempotent DDL for teleop help requests and proxy sessions (PostgreSQL).
 * Requires teleoperators table (see ensureTeleoperatorSchema).
 * @param {import('pg').Pool} pool
 */
async function ensureTeleopHelpSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS help_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      robot_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('open', 'claimed', 'cancelled', 'closed')),
      payload JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      claimed_by UUID REFERENCES teleoperators(id),
      claimed_at TIMESTAMPTZ
    );
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS help_requests_one_open_per_robot
    ON help_requests (robot_id)
    WHERE status = 'open';
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS help_requests_status_idx ON help_requests(status);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS teleop_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      help_request_id UUID NOT NULL REFERENCES help_requests(id),
      teleoperator_id UUID NOT NULL REFERENCES teleoperators(id),
      robot_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ended_at TIMESTAMPTZ
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS teleop_sessions_active_operator_idx
    ON teleop_sessions(teleoperator_id)
    WHERE ended_at IS NULL;
  `);
  await pool.query(`
    ALTER TABLE help_requests
    ADD COLUMN IF NOT EXISTS peaq_claim JSONB;
  `);
  await pool.query(`
    ALTER TABLE help_requests
    ADD COLUMN IF NOT EXISTS teleop_grant_payload TEXT;
  `);
  await pool.query(`
    ALTER TABLE help_requests
    ADD COLUMN IF NOT EXISTS teleop_grant_signature TEXT;
  `);
}

module.exports = { ensureTeleopHelpSchema };
