const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const { PublicKey } = require('@solana/web3.js');

const PG_UNIQUE_VIOLATION = '23505';
const MIN_PASSWORD_LENGTH = 8;
const MIN_LOGIN_LENGTH = 2;
const MAX_LOGIN_LENGTH = 64;

function normalizeLogin(login) {
  return String(login || '').trim().toLowerCase();
}

function validateAndCanonicalizeWalletPublicKey(walletPublicKey) {
  const trimmed = String(walletPublicKey || '').trim();
  if (!trimmed) {
    const err = new Error('walletPublicKey is required');
    err.code = 'VALIDATION';
    throw err;
  }
  try {
    return new PublicKey(trimmed).toBase58();
  } catch {
    const err = new Error('Invalid Solana wallet public key');
    err.code = 'VALIDATION';
    throw err;
  }
}

/**
 * @param {import('pg').Pool} pool
 * @param {{ bcryptRounds?: number }} options
 */
function createTeleoperatorRepository(pool, options = {}) {
  const bcryptRounds = options.bcryptRounds ?? 10;

  async function findWithSecretByLoginNormalized(loginNormalized) {
    const result = await pool.query(
      `SELECT id, login_normalized, password_hash, wallet_public_key, created_at
       FROM teleoperators WHERE login_normalized = $1`,
      [loginNormalized],
    );
    return result.rows[0] || null;
  }

  async function findPublicById(id) {
    const result = await pool.query(
      `SELECT id, login_normalized, wallet_public_key, created_at
       FROM teleoperators WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) return null;
    return toPublicProfile(row);
  }

  function toPublicProfile(row) {
    return {
      id: row.id,
      login: row.login_normalized,
      walletPublicKey: row.wallet_public_key,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    };
  }

  async function createUser({ login, password, walletPublicKey }) {
    const loginNormalized = normalizeLogin(login);
    if (loginNormalized.length < MIN_LOGIN_LENGTH || loginNormalized.length > MAX_LOGIN_LENGTH) {
      const err = new Error(`Login must be between ${MIN_LOGIN_LENGTH} and ${MAX_LOGIN_LENGTH} characters`);
      err.code = 'VALIDATION';
      throw err;
    }
    if (!password || String(password).length < MIN_PASSWORD_LENGTH) {
      const err = new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      err.code = 'VALIDATION';
      throw err;
    }
    const canonicalPk = validateAndCanonicalizeWalletPublicKey(walletPublicKey);
    const passwordHash = await bcrypt.hash(String(password), bcryptRounds);
    const id = uuidv4();

    try {
      const result = await pool.query(
        `INSERT INTO teleoperators (id, login_normalized, password_hash, wallet_public_key)
         VALUES ($1, $2, $3, $4)
         RETURNING id, login_normalized, wallet_public_key, created_at`,
        [id, loginNormalized, passwordHash, canonicalPk],
      );
      return toPublicProfile(result.rows[0]);
    } catch (error) {
      if (error.code === PG_UNIQUE_VIOLATION) {
        const err = new Error('Login already taken');
        err.code = 'CONFLICT';
        throw err;
      }
      throw error;
    }
  }

  async function verifyPassword(row, password) {
    if (!row?.password_hash) return false;
    return bcrypt.compare(String(password), row.password_hash);
  }

  async function listAllPublic() {
    const result = await pool.query(
      `SELECT id, login_normalized, wallet_public_key, created_at
       FROM teleoperators ORDER BY created_at ASC`,
    );
    return result.rows.map(toPublicProfile);
  }

  return {
    normalizeLogin,
    validateAndCanonicalizeWalletPublicKey,
    findWithSecretByLoginNormalized,
    findPublicById,
    listAllPublic,
    createUser,
    verifyPassword,
    toPublicProfile,
  };
}

module.exports = {
  createTeleoperatorRepository,
  normalizeLogin,
  MIN_PASSWORD_LENGTH,
  MIN_LOGIN_LENGTH,
  MAX_LOGIN_LENGTH,
};
