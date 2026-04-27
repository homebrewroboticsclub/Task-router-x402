/**
 * Idempotent DDL for teleoperator accounts (PostgreSQL).
 * @param {import('pg').Pool} pool
 */
async function ensureTeleoperatorSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS teleoperators (
      id UUID PRIMARY KEY,
      login_normalized TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      wallet_public_key TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

module.exports = { ensureTeleoperatorSchema };
