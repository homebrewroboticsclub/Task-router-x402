/**
 * Idempotent DDL for persisted robot registry (PostgreSQL).
 * @param {import('pg').Pool} pool
 */
async function ensureRobotSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS robots (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      requires_x402 BOOLEAN NOT NULL DEFAULT false,
      rosbridge_host TEXT NOT NULL,
      rosbridge_port INTEGER NOT NULL DEFAULT 9090,
      teleop_secret TEXT,
      enrollment_key TEXT,
      operator_registry_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  // Add columns before any index on them (legacy DBs had robots without enrollment_key).
  await pool.query(`ALTER TABLE robots ADD COLUMN IF NOT EXISTS enrollment_key TEXT;`);
  await pool.query(`ALTER TABLE robots ADD COLUMN IF NOT EXISTS operator_registry_url TEXT;`);
  await pool.query(`ALTER TABLE robots ADD COLUMN IF NOT EXISTS dataset_http_host TEXT;`);
  await pool.query(
    `ALTER TABLE robots ADD COLUMN IF NOT EXISTS dataset_http_port INTEGER;`,
  );
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS robots_enrollment_key_unique
    ON robots (enrollment_key) WHERE enrollment_key IS NOT NULL AND enrollment_key <> '';
  `);
}

module.exports = { ensureRobotSchema };
