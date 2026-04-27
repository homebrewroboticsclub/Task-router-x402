const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const RobotRegistry = require('../src/services/robotRegistry');
const { createRobotRepository } = require('../src/services/robotRepository');
const { ensureRobotSchema } = require('../src/db/ensureRobotSchema');
const { ensureTeleoperatorRobotGrantsSchema } = require('../src/db/ensureTeleoperatorRobotGrantsSchema');
const { ensureTeleoperatorSchema } = require('../src/db/ensureTeleoperatorSchema');
const { ensureTeleopHelpSchema } = require('../src/db/ensureTeleopHelpSchema');
const createHealthMonitor = require('../src/services/healthMonitor');
const X402Service = require('../src/services/x402Service');
const { loadConfig } = require('../src/config');

const connectionString = process.env.TEST_DATABASE_URL;
const run = connectionString ? describe : describe.skip;

run('robot registry PostgreSQL', () => {
  let pool;

  before(async () => {
    process.env.ROBOT_HEALTH_TIMEOUT_MS = '400';
    pool = new Pool({ connectionString });
    await ensureTeleoperatorSchema(pool);
    await ensureTeleopHelpSchema(pool);
    await ensureRobotSchema(pool);
    await ensureTeleoperatorRobotGrantsSchema(pool);
    await pool.query('DELETE FROM robots');
  });

  after(async () => {
    if (pool) {
      await pool.query('DELETE FROM robots');
      await pool.end();
    }
  });

  test('add persists; second registry loadFromPersistence sees robot', async () => {
    const config = loadConfig([]);
    const x402Service = new X402Service(config.x402);
    const healthMonitor = createHealthMonitor({ config, x402Service });
    const repo = createRobotRepository(pool);

    const reg1 = new RobotRegistry({ healthMonitor, robotRepository: repo });
    await reg1.loadFromPersistence();
    const created = await reg1.addRobot({
      name: 'db-bot',
      host: '10.0.0.1',
      port: 18080,
      teleopSecret: 'sec-db-test',
    });
    const id = created.id;

    const reg2 = new RobotRegistry({ healthMonitor, robotRepository: repo });
    await reg2.loadFromPersistence();
    assert.equal(reg2.list().length, 1);
    const again = reg2.getById(id);
    assert.ok(again);
    assert.equal(again.name, 'db-bot');
    assert.equal(again.host, '10.0.0.1');
    assert.equal(again.port, 18080);
    assert.equal(again.teleopSecret, 'sec-db-test');

    const removed = await reg2.removeRobot(id);
    assert.equal(removed, true);
    const reg3 = new RobotRegistry({ healthMonitor, robotRepository: repo });
    await reg3.loadFromPersistence();
    assert.equal(reg3.list().length, 0);
  });

  test('updateRobot writes through to DB', async () => {
    const config = loadConfig([]);
    const x402Service = new X402Service(config.x402);
    const healthMonitor = createHealthMonitor({ config, x402Service });
    const repo = createRobotRepository(pool);
    const reg = new RobotRegistry({ healthMonitor, robotRepository: repo });
    await reg.loadFromPersistence();
    const r = await reg.addRobot({ name: 'u1', host: '1.1.1.1', port: 1 });
    await reg.updateRobot(r.id, {
      name: 'u2',
      host: '2.2.2.2',
      port: 2,
      datasetHttpHost: 'dataset.internal',
      datasetHttpPort: 9192,
    });
    const reg2 = new RobotRegistry({ healthMonitor, robotRepository: repo });
    await reg2.loadFromPersistence();
    const loaded = reg2.getById(r.id);
    assert.equal(loaded.name, 'u2');
    assert.equal(loaded.host, '2.2.2.2');
    assert.equal(loaded.port, 2);
    assert.equal(loaded.datasetHttpHost, 'dataset.internal');
    assert.equal(loaded.datasetHttpPort, 9192);
    await reg2.removeRobot(r.id);
  });

  test('enrollOrUpdateRobot persists enrollment_key and is idempotent across restarts', async () => {
    const config = loadConfig([]);
    const x402Service = new X402Service(config.x402);
    const healthMonitor = createHealthMonitor({ config, x402Service });
    const repo = createRobotRepository(pool);
    const reg = new RobotRegistry({ healthMonitor, robotRepository: repo });
    await reg.loadFromPersistence();

    const a = await reg.enrollOrUpdateRobot({
      enrollmentKey: 'db-enroll-1',
      name: 'E1',
      host: '10.10.10.1',
      port: 1111,
    });
    const id = a.id;

    const reg2 = new RobotRegistry({ healthMonitor, robotRepository: repo });
    await reg2.loadFromPersistence();
    const b = await reg2.enrollOrUpdateRobot({
      enrollmentKey: 'db-enroll-1',
      name: 'E1-upd',
      host: '10.10.10.2',
      port: 2222,
    });
    assert.equal(b.id, id);
    assert.equal(b.host, '10.10.10.2');
    assert.equal(b.port, 2222);
    assert.equal(b.enrollmentKey, 'db-enroll-1');

    await reg2.removeRobot(id);
  });

  test('ensureRobotSchema upgrades legacy robots table missing enrollment_key', async () => {
    await pool.query('DROP TABLE IF EXISTS teleoperator_robot_grants CASCADE');
    await pool.query('DROP TABLE IF EXISTS robots CASCADE');
    await pool.query(`
      CREATE TABLE robots (
        id UUID PRIMARY KEY,
        name TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER NOT NULL,
        requires_x402 BOOLEAN NOT NULL DEFAULT false,
        rosbridge_host TEXT NOT NULL,
        rosbridge_port INTEGER NOT NULL DEFAULT 9090,
        teleop_secret TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await ensureRobotSchema(pool);
    const cols = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'robots'
       AND column_name IN ('enrollment_key', 'operator_registry_url', 'dataset_http_host', 'dataset_http_port', 'data_node_sync_override')`,
    );
    assert.equal(cols.rows.length, 5);
    await ensureRobotSchema(pool);
    await ensureTeleoperatorRobotGrantsSchema(pool);
    await pool.query('DELETE FROM robots');
  });
});
