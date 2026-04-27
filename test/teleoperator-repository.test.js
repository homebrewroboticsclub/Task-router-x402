const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { Keypair } = require('@solana/web3.js');
const { ensureTeleoperatorSchema } = require('../src/db/ensureTeleoperatorSchema');
const { createTeleoperatorRepository } = require('../src/services/teleoperatorRepository');

const connectionString = process.env.TEST_DATABASE_URL;
const run = connectionString ? describe : describe.skip;

run('teleoperatorRepository', () => {
  let pool;
  let repository;

  before(async () => {
    pool = new Pool({ connectionString });
    await ensureTeleoperatorSchema(pool);
    await pool.query('TRUNCATE teleoperators');
    repository = createTeleoperatorRepository(pool, { bcryptRounds: 4 });
  });

  after(async () => {
    if (pool) {
      await pool.query('TRUNCATE teleoperators');
      await pool.end();
    }
  });

  test('createUser and duplicate login', async () => {
    const walletPk = Keypair.generate().publicKey.toBase58();
    const user = await repository.createUser({
      login: 'OpOne',
      password: 'password12',
      walletPublicKey: walletPk,
    });
    assert.equal(user.login, 'opone');
    assert.equal(user.walletPublicKey, walletPk);

    await assert.rejects(
      () => repository.createUser({
        login: 'opone',
        password: 'password12',
        walletPublicKey: walletPk,
      }),
      (err) => err.code === 'CONFLICT',
    );
  });

  test('rejects short password', async () => {
    const walletPk = Keypair.generate().publicKey.toBase58();
    await assert.rejects(
      () => repository.createUser({
        login: 'shortpw',
        password: 'short',
        walletPublicKey: walletPk,
      }),
      (err) => err.code === 'VALIDATION',
    );
  });

  test('rejects invalid wallet public key', async () => {
    await assert.rejects(
      () => repository.createUser({
        login: 'badwallet',
        password: 'password12',
        walletPublicKey: 'not-a-solana-key',
      }),
      (err) => err.code === 'VALIDATION',
    );
  });
});
