const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('http');
const cookieParser = require('cookie-parser');
const request = require('supertest');
const { Pool } = require('pg');
const { Keypair } = require('@solana/web3.js');
const { ensureTeleoperatorSchema } = require('../src/db/ensureTeleoperatorSchema');
const { ensureTeleopHelpSchema } = require('../src/db/ensureTeleopHelpSchema');
const { ensureRobotSchema } = require('../src/db/ensureRobotSchema');
const { ensureTeleoperatorRobotGrantsSchema } = require('../src/db/ensureTeleoperatorRobotGrantsSchema');
const createTeleoperatorRouter = require('../src/routes/teleoperator');
const createTeleopHelpRouter = require('../src/routes/teleopHelp');
const createRobotsRouter = require('../src/routes/robots');
const RobotRegistry = require('../src/services/robotRegistry');
const createHealthMonitor = require('../src/services/healthMonitor');
const X402Service = require('../src/services/x402Service');
const { loadConfig } = require('../src/config');
const { createTeleopOperatorHub } = require('../src/services/teleopOperatorHub');
const { createRobotRepository } = require('../src/services/robotRepository');
const { createTeleoperatorRobotGrantRepository } = require('../src/services/teleoperatorRobotGrantRepository');
const {
  createAttachTeleopUser,
  createRequireTeleopSession,
} = require('../src/middleware/teleopSession');
const {
  createTeleopDatasetProxyMiddleware,
  resolveDatasetUpstream,
} = require('../src/services/teleopDatasetProxy');

const connectionString = process.env.TEST_DATABASE_URL;
const run = connectionString ? describe : describe.skip;

test('resolveDatasetUpstream falls back to host and 9191', () => {
  const u = resolveDatasetUpstream({
    host: '10.0.0.5',
    datasetHttpHost: null,
    datasetHttpPort: null,
  });
  assert.equal(u.host, '10.0.0.5');
  assert.equal(u.port, 9191);
});

test('resolveDatasetUpstream uses explicit dataset fields', () => {
  const u = resolveDatasetUpstream({
    host: '10.0.0.5',
    datasetHttpHost: 'ds.local',
    datasetHttpPort: 1234,
  });
  assert.equal(u.host, 'ds.local');
  assert.equal(u.port, 1234);
});

run('teleop dataset HTTP proxy', () => {
  let pool;
  let app;
  let registry;
  let grantRepository;
  let mockServer;
  let mockPort;
  const fleetSecret = 'fleet-dataset-proxy-test';

  before(async () => {
    process.env.ROBOT_FLEET_ENROLLMENT_SECRET = fleetSecret;
    process.env.ROBOT_HEALTH_TIMEOUT_MS = '400';
    process.env.TELEOP_DATASET_PROXY_TIMEOUT_MS = '8000';

    mockServer = http.createServer((req, res) => {
      const pathOnly = req.url.split('?')[0];
      if (pathOnly === '/dataset_status' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ proxied: true, path: pathOnly }));
        return;
      }
      if (pathOnly === '/upload_dataset' && req.method === 'POST') {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ gotBody: Buffer.concat(chunks).toString('utf8') }));
        });
        return;
      }
      res.writeHead(404);
      res.end('not found');
    });
    await new Promise((resolve) => {
      mockServer.listen(0, '127.0.0.1', resolve);
    });
    mockPort = mockServer.address().port;

    pool = new Pool({ connectionString });
    await ensureTeleoperatorSchema(pool);
    await ensureTeleopHelpSchema(pool);
    await ensureRobotSchema(pool);
    await ensureTeleoperatorRobotGrantsSchema(pool);
    await pool.query(
      'TRUNCATE help_request_operator_exclusions, teleop_sessions, help_requests, teleoperator_robot_grants, robots, teleoperators RESTART IDENTITY CASCADE',
    );

    const config = loadConfig([]);
    const x402Service = new X402Service(config.x402);
    const healthMonitor = createHealthMonitor({ config, x402Service });
    const robotRepository = createRobotRepository(pool);
    registry = new RobotRegistry({ healthMonitor, robotRepository });
    await registry.loadFromPersistence();
    grantRepository = createTeleoperatorRobotGrantRepository(pool);

    const teleopCfg = {
      teleoperator: {
        jwtSecret: 'test-secret-key-for-jwt-signing',
        jwtExpiresIn: '1h',
        cookieName: 'teleop_token',
        bcryptRounds: 4,
        cookieSecureMode: 'never',
      },
    };

    const attachTeleopUser = createAttachTeleopUser(teleopCfg.teleoperator);
    const requireTeleopSessionJson = createRequireTeleopSession({ mode: 'json' });
    const teleopHub = createTeleopOperatorHub();

    app = express();
    app.use(cookieParser());
    app.use(
      '/api/teleop',
      attachTeleopUser,
      requireTeleopSessionJson,
      createTeleopDatasetProxyMiddleware({
        registry,
        grantRepository,
        timeoutMs: config.teleop.datasetProxyTimeoutMs,
      }),
    );
    app.use(express.json());
    app.use('/api/teleoperator', createTeleoperatorRouter({ pool, config: teleopCfg }));
    app.use(
      '/api',
      createTeleopHelpRouter({
        pool,
        registry,
        teleopHub,
        attachTeleopUser,
        requireTeleopSession: requireTeleopSessionJson,
        grantRepository,
      }),
    );
    app.use(
      '/api/robots',
      createRobotsRouter({
        registry,
        config,
        adminConfig: config.admin,
      }),
    );
  });

  after(async () => {
    if (mockServer) {
      await new Promise((resolve) => mockServer.close(resolve));
    }
    if (pool) {
      await pool.query(
        'TRUNCATE help_request_operator_exclusions, teleop_sessions, help_requests, teleoperator_robot_grants, robots, teleoperators RESTART IDENTITY CASCADE',
      );
      await pool.end();
    }
  });

  test('401 without JWT', async () => {
    const enroll = await request(app)
      .post('/api/robots/enroll')
      .set('X-Robot-Fleet-Secret', fleetSecret)
      .send({ enrollmentKey: 'ds-proxy-a', host: '127.0.0.1', port: 1, datasetHttpPort: mockPort })
      .expect(200);

    await request(app)
      .get(`/api/teleop/robots/${enroll.body.id}/dataset/dataset_status`)
      .expect(401);
  });

  test('GET proxies to upstream with query string', async () => {
    const kp = Keypair.generate();
    const login = `ds_op_${Date.now()}`;
    await request(app)
      .post('/api/teleoperator/register')
      .send({
        login,
        password: 'password1',
        walletPublicKey: kp.publicKey.toBase58(),
      })
      .expect(201);

    const enroll = await request(app)
      .post('/api/robots/enroll')
      .set('X-Robot-Fleet-Secret', fleetSecret)
      .send({ enrollmentKey: 'ds-proxy-b', host: '127.0.0.1', port: 1, datasetHttpPort: mockPort })
      .expect(200);

    const me = await request(app)
      .post('/api/teleoperator/login')
      .send({ login, password: 'password1' })
      .expect(200);

    const jwt = me.body.accessToken;

    const r = await request(app)
      .get(`/api/teleop/robots/${enroll.body.id}/dataset/dataset_status?x=1`)
      .set('Authorization', `Bearer ${jwt}`)
      .expect(200);

    assert.equal(r.body.proxied, true);
    assert.equal(r.body.path, '/dataset_status');
  });

  test('POST body is streamed to upstream', async () => {
    const kp = Keypair.generate();
    const login = `ds_op2_${Date.now()}`;
    await request(app)
      .post('/api/teleoperator/register')
      .send({
        login,
        password: 'password22',
        walletPublicKey: kp.publicKey.toBase58(),
      })
      .expect(201);

    const enroll = await request(app)
      .post('/api/robots/enroll')
      .set('X-Robot-Fleet-Secret', fleetSecret)
      .send({ enrollmentKey: 'ds-proxy-c', host: '127.0.0.1', port: 1, datasetHttpPort: mockPort })
      .expect(200);

    const me = await request(app)
      .post('/api/teleoperator/login')
      .send({ login, password: 'password22' })
      .expect(200);

    const jwt = me.body.accessToken;
    const payload = { hello: 'world' };

    const r = await request(app)
      .post(`/api/teleop/robots/${enroll.body.id}/dataset/upload_dataset`)
      .set('Authorization', `Bearer ${jwt}`)
      .set('Content-Type', 'application/json')
      .send(payload)
      .expect(200);

    const parsed = JSON.parse(r.body.gotBody);
    assert.equal(parsed.hello, 'world');
  });

  test('403 when robot has grants and operator lacks grant', async () => {
    const kpA = Keypair.generate();
    const kpB = Keypair.generate();
    const loginA = `ds_gr_a_${Date.now()}`;
    const loginB = `ds_gr_b_${Date.now()}`;

    const regA = await request(app)
      .post('/api/teleoperator/register')
      .send({
        login: loginA,
        password: 'passwordA',
        walletPublicKey: kpA.publicKey.toBase58(),
      })
      .expect(201);
    const regB = await request(app)
      .post('/api/teleoperator/register')
      .send({
        login: loginB,
        password: 'passwordB',
        walletPublicKey: kpB.publicKey.toBase58(),
      })
      .expect(201);

    const enroll = await request(app)
      .post('/api/robots/enroll')
      .set('X-Robot-Fleet-Secret', fleetSecret)
      .send({ enrollmentKey: 'ds-proxy-gr', host: '127.0.0.1', port: 1, datasetHttpPort: mockPort })
      .expect(200);

    await grantRepository.grant({
      teleoperatorId: regA.body.user.id,
      robotId: enroll.body.id,
    });

    const tokB = await request(app)
      .post('/api/teleoperator/login')
      .send({ login: loginB, password: 'passwordB' })
      .expect(200);

    await request(app)
      .get(`/api/teleop/robots/${enroll.body.id}/dataset/dataset_status`)
      .set('Authorization', `Bearer ${tokB.body.accessToken}`)
      .expect(403);
  });
});
