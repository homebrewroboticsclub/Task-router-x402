const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
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
const { createPeaqClaimService } = require('../src/services/peaqClaimService');
const { createTeleopSessionGrantService } = require('../src/services/teleopSessionGrantService');
const { ed25519 } = require('@noble/curves/ed25519');
const bs58Module = require('bs58');
const bs58 = bs58Module.encode ? bs58Module : bs58Module.default;

const connectionString = process.env.TEST_DATABASE_URL;
const run = connectionString ? describe : describe.skip;

run('teleop help HTTP', () => {
  let pool;
  let app;
  let registry;
  let grantRepository;
  let grantSigningKeypair;
  const teleopSecret = 'test-teleop-secret-xyz';
  const fleetSecret = 'fleet-teleop-help-test';

  before(async () => {
    process.env.ROBOT_FLEET_ENROLLMENT_SECRET = fleetSecret;
    process.env.ROBOT_HEALTH_TIMEOUT_MS = '400';
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

    grantSigningKeypair = Keypair.generate();
    const teleopSessionGrantService = createTeleopSessionGrantService({
      signingSecretKey: JSON.stringify(Array.from(grantSigningKeypair.secretKey)),
      ttlSec: 3600,
      operatorFlatPaymentSol: 0.0005,
    });

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
    const teleopHub = createTeleopOperatorHub();

    const peaqFailureHelper = createPeaqClaimService({
      enabled: true,
      httpBaseUrl: 'https://example.invalid',
      wssBaseUrl: 'wss://example.invalid',
      machineDidName: 'test_machine',
      machineEvmAddress: `0x${'0'.repeat(40)}`,
      networkLabel: 'peaq-agung',
      claimSyncTimeoutMs: 2500,
    });
    const mockPeaqClaimService = {
      isEnabled: () => true,
      buildClaim: async ({ helpRequestId, robotId }) => ({
        schema_version: 1,
        network: 'peaq-agung',
        help_request_id: helpRequestId,
        robot_id: robotId,
        issued_at_unix: 1700000000,
        document: { id: 'did:peaq:0xtest' },
        raw: {},
      }),
      buildFailureClaim: (input) => peaqFailureHelper.buildFailureClaim(input),
    };

    app = express();
    app.use(cookieParser());
    app.use(express.json());
    // Same order as src/index.js: /api teleop help before /api/robots so regressions match production.
    app.use('/api/teleoperator', createTeleoperatorRouter({ pool, config: teleopCfg }));
    app.use(
      '/api',
      createTeleopHelpRouter({
        pool,
        registry,
        teleopHub,
        attachTeleopUser,
        requireTeleopSession: createRequireTeleopSession({ mode: 'json' }),
        grantRepository,
        peaqClaimService: mockPeaqClaimService,
        peaqClaimSyncTimeoutMs: 30000,
        teleopSessionGrantService,
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
    if (pool) {
      await pool.query(
        'TRUNCATE help_request_operator_exclusions, teleop_sessions, help_requests, teleoperator_robot_grants, robots, teleoperators RESTART IDENTITY CASCADE',
      );
      await pool.end();
    }
  });

  test('POST /api/robots/enroll reaches fleet auth after /api teleop mount (regression)', async () => {
    const bad = await request(app)
      .post('/api/robots/enroll')
      .send({ enrollmentKey: 'enroll-route-reg', host: '127.0.0.1', port: 49001 })
      .expect(401);
    assert.notEqual(bad.body.error, 'Unauthorized');
    assert.match(String(bad.body.error || ''), /fleet|credential/i);

    const ok = await request(app)
      .post('/api/robots/enroll')
      .set('X-Robot-Fleet-Secret', fleetSecret)
      .send({ enrollmentKey: 'enroll-route-reg', host: '127.0.0.1', port: 49002 })
      .expect(200);
    assert.ok(ok.body.id);
    assert.ok(ok.body.teleopSecret);
  });

  test('help without secret 401; list and accept flow', async () => {
    const reg = await registry.addRobot({
      name: 'tbot',
      host: '127.0.0.1',
      port: 65534,
      teleopSecret,
    });
    const robotId = reg.id;

    await request(app)
      .post(`/api/robots/${robotId}/teleop/help`)
      .send({ message: 'need help', metadata: {} })
      .expect(401);

    await request(app)
      .post(`/api/robots/${robotId}/teleop/help`)
      .set('X-Robot-Teleop-Secret', teleopSecret)
      .send({})
      .expect(400);

    const badMeta = await request(app)
      .post(`/api/robots/${robotId}/teleop/help`)
      .set('X-Robot-Teleop-Secret', teleopSecret)
      .send({ message: 'x' })
      .expect(400);
    assert.match(String(badMeta.body.error || ''), /metadata/i);

    const resHelp = await request(app)
      .post(`/api/robots/${robotId}/teleop/help`)
      .set('X-Robot-Teleop-Secret', teleopSecret)
      .send({ message: 'need help', metadata: {} })
      .expect(201);
    assert.equal(resHelp.body.duplicate, false);
    const helpId = resHelp.body.helpRequest.id;
    assert.ok(
      typeof resHelp.body.teleopGrantPollUrl === 'string'
        && resHelp.body.teleopGrantPollUrl.includes(helpId)
        && resHelp.body.teleopGrantPollUrl.includes('/teleop/session-grant'),
    );

    const walletPk = Keypair.generate().publicKey.toBase58();
    const agent = request.agent(app);
    await agent
      .post('/api/teleoperator/register')
      .send({ login: 'ophelp1', password: 'password12', walletPublicKey: walletPk })
      .expect(201);

    const list = await agent.get('/api/teleoperator/help-requests').expect(200);
    assert.equal(list.body.helpRequests.length, 1);
    assert.equal(list.body.helpRequests[0].id, helpId);
    const p = list.body.helpRequests[0].payload;
    assert.equal(p.message, 'need help');
    assert.equal(p.metadata.task_id, '');
    assert.equal(p.metadata.error_context, '');
    assert.equal(p.metadata.situation_report, '');
    assert.equal(p.metadata.dataset_id, '');
    assert.equal(p.metadata.kyr_session_id, '');
    assert.equal(p.metadata.kyr_robot_id, '');

    const acc = await agent
      .post(`/api/teleoperator/help-requests/${helpId}/accept`)
      .expect(200);
    assert.ok(acc.body.session?.id);

    const grantRes = await request(app)
      .get(`/api/robots/${robotId}/teleop/session-grant`)
      .query({ helpRequestId: helpId })
      .set('X-Robot-Teleop-Secret', teleopSecret)
      .expect(200);
    assert.ok(typeof grantRes.body.teleopGrantPayload === 'string');
    assert.ok(typeof grantRes.body.teleopGrantSignature === 'string');
    const grantObj = JSON.parse(grantRes.body.teleopGrantPayload);
    assert.equal(grantObj.operator_pubkey, walletPk);
    assert.equal(grantObj.robot_id, robotId);
    assert.equal(grantObj.session_id, acc.body.session.id);
    const scope = JSON.parse(grantObj.scope_json);
    assert.equal(scope.teleop_payment_mode, 'flat');
    assert.equal(scope.teleop_operator_flat_sol, 0.0005);
    const msg = new TextEncoder().encode(grantRes.body.teleopGrantPayload);
    const sig = bs58.decode(grantRes.body.teleopGrantSignature);
    assert.ok(ed25519.verify(sig, msg, grantSigningKeypair.publicKey.toBytes()));
    assert.equal(
      grantRes.body.grantSignerPublicKey,
      grantSigningKeypair.publicKey.toBase58(),
    );

    await agent.get('/api/teleoperator/help-requests').expect(200);
    assert.equal((await agent.get('/api/teleoperator/help-requests')).body.helpRequests.length, 0);
  });

  test('GET session-grant returns grant_not_ready before accept', async () => {
    const reg = await registry.addRobot({
      host: '127.0.0.1',
      port: 65531,
      teleopSecret,
    });
    const h = await request(app)
      .post(`/api/robots/${reg.id}/teleop/help`)
      .set('X-Robot-Teleop-Secret', teleopSecret)
      .send({ message: 'open', metadata: {} })
      .expect(201);
    const nid = h.body.helpRequest.id;
    const g = await request(app)
      .get(`/api/robots/${reg.id}/teleop/session-grant`)
      .query({ helpRequestId: nid })
      .set('X-Robot-Teleop-Secret', teleopSecret)
      .expect(404);
    assert.equal(g.body.error, 'grant_not_ready');
  });

  test('duplicate open help returns 200 and duplicate true', async () => {
    const reg = await registry.addRobot({
      host: '127.0.0.1',
      port: 65533,
      teleopSecret,
    });
    const r1 = await request(app)
      .post(`/api/robots/${reg.id}/teleop/help`)
      .set('X-Robot-Teleop-Secret', teleopSecret)
      .send({ message: 'help', metadata: {} })
      .expect(201);
    const r2 = await request(app)
      .post(`/api/robots/${reg.id}/teleop/help`)
      .set('X-Robot-Teleop-Secret', teleopSecret)
      .send({ message: 'help again', metadata: {} })
      .expect(200);
    assert.equal(r2.body.duplicate, true);
    assert.equal(r2.body.helpRequest.id, r1.body.helpRequest.id);
  });

  test('second operator gets 409 on accept', async () => {
    await pool.query(
      'TRUNCATE help_request_operator_exclusions, teleop_sessions, help_requests, teleoperator_robot_grants, robots, teleoperators RESTART IDENTITY CASCADE',
    );
    await registry.loadFromPersistence();

    const reg = await registry.addRobot({
      host: '127.0.0.1',
      port: 65532,
      teleopSecret,
    });
    const h = await request(app)
      .post(`/api/robots/${reg.id}/teleop/help`)
      .set('X-Robot-Teleop-Secret', teleopSecret)
      .send({ message: 'help', metadata: {} })
      .expect(201);

    const w1 = Keypair.generate().publicKey.toBase58();
    const w2 = Keypair.generate().publicKey.toBase58();
    const a1 = request.agent(app);
    const a2 = request.agent(app);
    await a1
      .post('/api/teleoperator/register')
      .send({ login: 'opa', password: 'password12', walletPublicKey: w1 })
      .expect(201);
    await a2
      .post('/api/teleoperator/register')
      .send({ login: 'opb', password: 'password12', walletPublicKey: w2 })
      .expect(201);

    await a1.post(`/api/teleoperator/help-requests/${h.body.helpRequest.id}/accept`).expect(200);
    await a2.post(`/api/teleoperator/help-requests/${h.body.helpRequest.id}/accept`).expect(409);
  });

  test('accept 403 when another operator has grant but not this one', async () => {
    await pool.query(
      'TRUNCATE help_request_operator_exclusions, teleop_sessions, help_requests, teleoperator_robot_grants, robots, teleoperators RESTART IDENTITY CASCADE',
    );
    await registry.loadFromPersistence();

    const reg = await registry.addRobot({
      host: '127.0.0.1',
      port: 65530,
      teleopSecret,
    });
    const h = await request(app)
      .post(`/api/robots/${reg.id}/teleop/help`)
      .set('X-Robot-Teleop-Secret', teleopSecret)
      .send({ message: 'help', metadata: {} })
      .expect(201);

    const w1 = Keypair.generate().publicKey.toBase58();
    const w2 = Keypair.generate().publicKey.toBase58();
    const a1 = request.agent(app);
    const a2 = request.agent(app);
    const reg1 = await a1
      .post('/api/teleoperator/register')
      .send({ login: 'opx1', password: 'password12', walletPublicKey: w1 })
      .expect(201);
    await a2
      .post('/api/teleoperator/register')
      .send({ login: 'opx2', password: 'password12', walletPublicKey: w2 })
      .expect(201);

    await grantRepository.grant({ teleoperatorId: reg1.body.user.id, robotId: reg.id });

    const listDenied = await a2.get('/api/teleoperator/help-requests').expect(200);
    assert.equal(listDenied.body.helpRequests.length, 0);
    const listGranted = await a1.get('/api/teleoperator/help-requests').expect(200);
    assert.equal(listGranted.body.helpRequests.length, 1);
    assert.equal(listGranted.body.helpRequests[0].id, h.body.helpRequest.id);

    await a2.post(`/api/teleoperator/help-requests/${h.body.helpRequest.id}/accept`).expect(403);
  });

  test('help list shows granted robot only to granted operator; open robot to all', async () => {
    await pool.query(
      'TRUNCATE help_request_operator_exclusions, teleop_sessions, help_requests, teleoperator_robot_grants, robots, teleoperators RESTART IDENTITY CASCADE',
    );
    await registry.loadFromPersistence();

    const rGranted = await registry.addRobot({
      host: '127.0.0.1',
      port: 65528,
      teleopSecret,
    });
    const rOpen = await registry.addRobot({
      host: '127.0.0.1',
      port: 65527,
      teleopSecret,
    });

    const w1 = Keypair.generate().publicKey.toBase58();
    const w2 = Keypair.generate().publicKey.toBase58();
    const a1 = request.agent(app);
    const a2 = request.agent(app);
    const reg1 = await a1
      .post('/api/teleoperator/register')
      .send({ login: 'mix1', password: 'password12', walletPublicKey: w1 })
      .expect(201);
    await a2
      .post('/api/teleoperator/register')
      .send({ login: 'mix2', password: 'password12', walletPublicKey: w2 })
      .expect(201);

    await grantRepository.grant({ teleoperatorId: reg1.body.user.id, robotId: rGranted.id });

    await request(app)
      .post(`/api/robots/${rGranted.id}/teleop/help`)
      .set('X-Robot-Teleop-Secret', teleopSecret)
      .send({ message: 'granted robot', metadata: {} })
      .expect(201);
    const hOpen = await request(app)
      .post(`/api/robots/${rOpen.id}/teleop/help`)
      .set('X-Robot-Teleop-Secret', teleopSecret)
      .send({ message: 'open robot', metadata: {} })
      .expect(201);

    const l1 = await a1.get('/api/teleoperator/help-requests').expect(200);
    assert.equal(l1.body.helpRequests.length, 2);

    const l2 = await a2.get('/api/teleoperator/help-requests').expect(200);
    assert.equal(l2.body.helpRequests.length, 1);
    assert.equal(l2.body.helpRequests[0].id, hOpen.body.helpRequest.id);
  });

  test('help payload includes situation_report for operator list', async () => {
    await pool.query(
      'TRUNCATE help_request_operator_exclusions, teleop_sessions, help_requests, teleoperator_robot_grants, robots, teleoperators RESTART IDENTITY CASCADE',
    );
    await registry.loadFromPersistence();

    const reg = await registry.addRobot({
      host: '127.0.0.1',
      port: 65526,
      teleopSecret,
    });
    const sr = 'Stuck near obstacle; last cmd was nav_goal.';
    await request(app)
      .post(`/api/robots/${reg.id}/teleop/help`)
      .set('X-Robot-Teleop-Secret', teleopSecret)
      .send({
        message: 'Need assistance',
        metadata: {
          task_id: 'sess-9',
          error_context: '{"n":1}',
          situation_report: sr,
        },
      })
      .expect(201);

    const w = Keypair.generate().publicKey.toBase58();
    const agent = request.agent(app);
    await agent
      .post('/api/teleoperator/register')
      .send({ login: 'opsr', password: 'password12', walletPublicKey: w })
      .expect(201);
    const list = await agent.get('/api/teleoperator/help-requests').expect(200);
    assert.equal(list.body.helpRequests.length, 1);
    const p = list.body.helpRequests[0].payload;
    assert.equal(p.metadata.task_id, 'sess-9');
    assert.equal(p.metadata.error_context, '{"n":1}');
    assert.equal(p.metadata.situation_report, sr);
  });

  test('help payload includes DATA_NODE correlation metadata for operator list', async () => {
    await pool.query(
      'TRUNCATE help_request_operator_exclusions, teleop_sessions, help_requests, teleoperator_robot_grants, robots, teleoperators RESTART IDENTITY CASCADE',
    );
    await registry.loadFromPersistence();

    const reg = await registry.addRobot({
      host: '127.0.0.1',
      port: 65527,
      teleopSecret,
    });
    await request(app)
      .post(`/api/robots/${reg.id}/teleop/help`)
      .set('X-Robot-Teleop-Secret', teleopSecret)
      .send({
        message: 'Correlate me',
        metadata: {
          task_id: 't-ds',
          error_context: '',
          dataset_id: 'ds-abc',
          kyr_session_id: 'kyr-sess-1',
          kyr_robot_id: 'robot-string-7',
        },
      })
      .expect(201);

    const w = Keypair.generate().publicKey.toBase58();
    const agent = request.agent(app);
    await agent
      .post('/api/teleoperator/register')
      .send({ login: 'opdn', password: 'password12', walletPublicKey: w })
      .expect(201);
    const list = await agent.get('/api/teleoperator/help-requests').expect(200);
    assert.equal(list.body.helpRequests.length, 1);
    const p = list.body.helpRequests[0].payload;
    assert.equal(p.metadata.dataset_id, 'ds-abc');
    assert.equal(p.metadata.kyr_session_id, 'kyr-sess-1');
    assert.equal(p.metadata.kyr_robot_id, 'robot-string-7');
  });

  test('grantRepository listActive exposes teleoperator_login (login_normalized)', async () => {
    await pool.query(
      'TRUNCATE help_request_operator_exclusions, teleop_sessions, help_requests, teleoperator_robot_grants, robots, teleoperators RESTART IDENTITY CASCADE',
    );
    await registry.loadFromPersistence();

    const reg = await registry.addRobot({
      host: '127.0.0.1',
      port: 65529,
      teleopSecret,
    });
    const w = Keypair.generate().publicKey.toBase58();
    const regOp = await request(app)
      .post('/api/teleoperator/register')
      .send({ login: 'ListGrantUser', password: 'password12', walletPublicKey: w })
      .expect(201);
    await grantRepository.grant({ teleoperatorId: regOp.body.user.id, robotId: reg.id });
    const rows = await grantRepository.listActive();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].teleoperator_login, 'listgrantuser');
  });

  test('help response includes top-level id, peaq_claim; GET peaq/claim with secret', async () => {
    await pool.query(
      'TRUNCATE help_request_operator_exclusions, teleop_sessions, help_requests, teleoperator_robot_grants, robots, teleoperators RESTART IDENTITY CASCADE',
    );
    await registry.loadFromPersistence();

    const reg = await registry.addRobot({
      host: '127.0.0.1',
      port: 65525,
      teleopSecret,
    });
    const resHelp = await request(app)
      .post(`/api/robots/${reg.id}/teleop/help`)
      .set('X-Robot-Teleop-Secret', teleopSecret)
      .send({
        message: 'peaq help',
        metadata: {
          task_id: 't1',
          error_context: '',
          kyr_peaq_context: { schema_version: 1, robot_id: 'r1' },
        },
      })
      .expect(201);
    assert.equal(resHelp.body.id, resHelp.body.helpRequest.id);
    assert.ok(resHelp.body.peaq_claim);
    assert.equal(resHelp.body.peaq_claim.help_request_id, resHelp.body.helpRequest.id);
    assert.deepEqual(resHelp.body.helpRequest.payload.metadata.kyr_peaq_context, {
      schema_version: 1,
      robot_id: 'r1',
    });

    await request(app)
      .get(`/api/robots/${reg.id}/peaq/claim`)
      .expect(401);

    const badUuid = await request(app)
      .get(`/api/robots/${reg.id}/peaq/claim?helpRequestId=not-a-uuid`)
      .set('X-Robot-Teleop-Secret', teleopSecret)
      .expect(400);
    assert.match(String(badUuid.body.error || ''), /uuid/i);

    const rnd = '00000000-0000-4000-8000-000000000001';
    const miss = await request(app)
      .get(`/api/robots/${reg.id}/peaq/claim?helpRequestId=${rnd}`)
      .set('X-Robot-Teleop-Secret', teleopSecret)
      .expect(404);
    assert.equal(miss.body.error, 'claim_not_ready');

    const ok = await request(app)
      .get(`/api/robots/${reg.id}/peaq/claim?helpRequestId=${resHelp.body.helpRequest.id}`)
      .set('X-Robot-Teleop-Secret', teleopSecret)
      .expect(200);
    assert.ok(ok.body.peaq_claim);
    assert.equal(ok.body.peaq_claim.network, 'peaq-agung');
  });

  test('POST help 413 when kyr_peaq_context JSON exceeds 64 KiB', async () => {
    await pool.query(
      'TRUNCATE help_request_operator_exclusions, teleop_sessions, help_requests, teleoperator_robot_grants, robots, teleoperators RESTART IDENTITY CASCADE',
    );
    await registry.loadFromPersistence();

    const reg = await registry.addRobot({
      host: '127.0.0.1',
      port: 65524,
      teleopSecret,
    });
    const blob = 'x'.repeat(70000);
    await request(app)
      .post(`/api/robots/${reg.id}/teleop/help`)
      .set('X-Robot-Teleop-Secret', teleopSecret)
      .send({
        message: 'm',
        metadata: { kyr_peaq_context: { blob } },
      })
      .expect(413);
  });

  test('GET peaq/claim 404 when peaq disabled (no stored claim)', async () => {
    await pool.query(
      'TRUNCATE help_request_operator_exclusions, teleop_sessions, help_requests, teleoperator_robot_grants, robots, teleoperators RESTART IDENTITY CASCADE',
    );
    await registry.loadFromPersistence();

    const reg = await registry.addRobot({
      host: '127.0.0.1',
      port: 65523,
      teleopSecret,
    });

    const localApp = express();
    localApp.use(express.json());
    localApp.use(cookieParser());
    const teleopCfgLocal = {
      teleoperator: {
        jwtSecret: 'test-secret-key-for-jwt-signing',
        jwtExpiresIn: '1h',
        cookieName: 'teleop_token',
        bcryptRounds: 4,
        cookieSecureMode: 'never',
      },
    };
    const attachLocal = createAttachTeleopUser(teleopCfgLocal.teleoperator);
    localApp.use(
      '/api',
      createTeleopHelpRouter({
        pool,
        registry,
        teleopHub: createTeleopOperatorHub(),
        attachTeleopUser: attachLocal,
        requireTeleopSession: createRequireTeleopSession({ mode: 'json' }),
        grantRepository,
        peaqClaimService: { isEnabled: () => false, buildClaim: async () => ({}) },
        peaqClaimSyncTimeoutMs: 2500,
        config: null,
      }),
    );

    const h = await request(localApp)
      .post(`/api/robots/${reg.id}/teleop/help`)
      .set('X-Robot-Teleop-Secret', teleopSecret)
      .send({ message: 'no peaq', metadata: {} })
      .expect(201);
    assert.equal(h.body.peaq_claim, undefined);

    await request(localApp)
      .get(`/api/robots/${reg.id}/peaq/claim?helpRequestId=${h.body.helpRequest.id}`)
      .set('X-Robot-Teleop-Secret', teleopSecret)
      .expect(404);
  });

  test('POST help peaq fallback when buildClaim rejects: stored failure claim, GET returns 200', async () => {
    await pool.query(
      'TRUNCATE help_request_operator_exclusions, teleop_sessions, help_requests, teleoperator_robot_grants, robots, teleoperators RESTART IDENTITY CASCADE',
    );
    await registry.loadFromPersistence();

    const reg = await registry.addRobot({
      host: '127.0.0.1',
      port: 65522,
      teleopSecret,
    });

    const failSvc = createPeaqClaimService({
      enabled: true,
      httpBaseUrl: 'https://example.invalid',
      wssBaseUrl: 'wss://example.invalid',
      machineDidName: 'm',
      machineEvmAddress: `0x${'1'.repeat(40)}`,
      networkLabel: 'peaq-agung',
      claimSyncTimeoutMs: 2500,
    });

    const localApp = express();
    localApp.use(express.json());
    localApp.use(cookieParser());
    const teleopCfgLocal = {
      teleoperator: {
        jwtSecret: 'test-secret-key-for-jwt-signing',
        jwtExpiresIn: '1h',
        cookieName: 'teleop_token',
        bcryptRounds: 4,
        cookieSecureMode: 'never',
      },
    };
    const attachLocal = createAttachTeleopUser(teleopCfgLocal.teleoperator);
    localApp.use(
      '/api',
      createTeleopHelpRouter({
        pool,
        registry,
        teleopHub: createTeleopOperatorHub(),
        attachTeleopUser: attachLocal,
        requireTeleopSession: createRequireTeleopSession({ mode: 'json' }),
        grantRepository,
        peaqClaimService: {
          isEnabled: () => true,
          buildClaim: async () => {
            throw new Error('did.read simulated failure');
          },
          buildFailureClaim: (input) => failSvc.buildFailureClaim(input),
        },
        peaqClaimSyncTimeoutMs: 30000,
        config: null,
      }),
    );

    const resHelp = await request(localApp)
      .post(`/api/robots/${reg.id}/teleop/help`)
      .set('X-Robot-Teleop-Secret', teleopSecret)
      .send({ message: 'm', metadata: {} })
      .expect(201);
    assert.equal(resHelp.body.peaq_claim.raid_peaq_read_status, 'failed');
    assert.match(String(resHelp.body.peaq_claim.raid_peaq_error || ''), /simulated failure/i);

    const ok = await request(localApp)
      .get(`/api/robots/${reg.id}/peaq/claim?helpRequestId=${resHelp.body.helpRequest.id}`)
      .set('X-Robot-Teleop-Secret', teleopSecret)
      .expect(200);
    assert.equal(ok.body.peaq_claim.raid_peaq_read_status, 'failed');
  });

  test('decline-before-connect reopens help and excludes operator; second operator can accept', async () => {
    await pool.query(
      'TRUNCATE help_request_operator_exclusions, teleop_sessions, help_requests, teleoperator_robot_grants, robots, teleoperators RESTART IDENTITY CASCADE',
    );
    await registry.loadFromPersistence();

    const reg = await registry.addRobot({
      host: '127.0.0.1',
      port: 65519,
      teleopSecret,
    });
    const robotId = reg.id;

    const h = await request(app)
      .post(`/api/robots/${robotId}/teleop/help`)
      .set('X-Robot-Teleop-Secret', teleopSecret)
      .send({ message: 'd1', metadata: {} })
      .expect(201);
    const helpId = h.body.helpRequest.id;

    const w1 = Keypair.generate().publicKey.toBase58();
    const w2 = Keypair.generate().publicKey.toBase58();
    const agent1 = request.agent(app);
    await agent1
      .post('/api/teleoperator/register')
      .send({ login: 'decl1', password: 'password12', walletPublicKey: w1 })
      .expect(201);
    const acc = await agent1.post(`/api/teleoperator/help-requests/${helpId}/accept`).expect(200);
    const sessionId = acc.body.session.id;

    const decl = await agent1
      .post(`/api/teleoperator/sessions/${sessionId}/decline-before-connect`)
      .expect(200);
    assert.equal(decl.body.helpRequest.status, 'open');

    const g = await request(app)
      .get(`/api/robots/${robotId}/teleop/session-grant`)
      .query({ helpRequestId: helpId })
      .set('X-Robot-Teleop-Secret', teleopSecret)
      .expect(404);
    assert.equal(g.body.error, 'grant_not_ready');

    const list1 = await agent1.get('/api/teleoperator/help-requests').expect(200);
    assert.equal(list1.body.helpRequests.length, 0);

    const agent2 = request.agent(app);
    await agent2
      .post('/api/teleoperator/register')
      .send({ login: 'decl2', password: 'password12', walletPublicKey: w2 })
      .expect(201);
    const list2 = await agent2.get('/api/teleoperator/help-requests').expect(200);
    assert.equal(list2.body.helpRequests.length, 1);
    assert.equal(list2.body.helpRequests[0].id, helpId);

    await agent2.post(`/api/teleoperator/help-requests/${helpId}/accept`).expect(200);
  });

  test('decline-before-connect 409 after robot_proxy_connected_at set', async () => {
    await pool.query(
      'TRUNCATE help_request_operator_exclusions, teleop_sessions, help_requests, teleoperator_robot_grants, robots, teleoperators RESTART IDENTITY CASCADE',
    );
    await registry.loadFromPersistence();

    const reg = await registry.addRobot({
      host: '127.0.0.1',
      port: 65518,
      teleopSecret,
    });
    const robotId = reg.id;

    const h = await request(app)
      .post(`/api/robots/${robotId}/teleop/help`)
      .set('X-Robot-Teleop-Secret', teleopSecret)
      .send({ message: 'd2', metadata: {} })
      .expect(201);
    const helpId = h.body.helpRequest.id;

    const agent = request.agent(app);
    const w = Keypair.generate().publicKey.toBase58();
    await agent
      .post('/api/teleoperator/register')
      .send({ login: 'decl3', password: 'password12', walletPublicKey: w })
      .expect(201);
    const acc = await agent.post(`/api/teleoperator/help-requests/${helpId}/accept`).expect(200);
    const sessionId = acc.body.session.id;

    await pool.query(
      `UPDATE teleop_sessions SET robot_proxy_connected_at = NOW() WHERE id = $1`,
      [sessionId],
    );

    await agent.post(`/api/teleoperator/sessions/${sessionId}/decline-before-connect`).expect(409);
  });

  test('POST sessions end: 409 when proxy not connected; idempotent after end', async () => {
    await pool.query(
      'TRUNCATE help_request_operator_exclusions, teleop_sessions, help_requests, teleoperator_robot_grants, robots, teleoperators RESTART IDENTITY CASCADE',
    );
    await registry.loadFromPersistence();

    const reg = await registry.addRobot({
      host: '127.0.0.1',
      port: 65517,
      teleopSecret,
    });
    const robotId = reg.id;

    const h = await request(app)
      .post(`/api/robots/${robotId}/teleop/help`)
      .set('X-Robot-Teleop-Secret', teleopSecret)
      .send({ message: 'end1', metadata: {} })
      .expect(201);
    const helpId = h.body.helpRequest.id;

    const agent = request.agent(app);
    const w = Keypair.generate().publicKey.toBase58();
    await agent
      .post('/api/teleoperator/register')
      .send({ login: 'endop', password: 'password12', walletPublicKey: w })
      .expect(201);
    const acc = await agent.post(`/api/teleoperator/help-requests/${helpId}/accept`).expect(200);
    const sessionId = acc.body.session.id;

    const bad = await agent
      .post(`/api/teleoperator/sessions/${sessionId}/end`)
      .send({ reason: 'graceful_complete' })
      .expect(409);
    assert.match(String(bad.body.error || ''), /decline-before-connect/i);

    await pool.query(
      `UPDATE teleop_sessions SET robot_proxy_connected_at = NOW() WHERE id = $1`,
      [sessionId],
    );

    const ok = await agent
      .post(`/api/teleoperator/sessions/${sessionId}/end`)
      .send({ reason: 'graceful_complete' })
      .expect(200);
    assert.equal(ok.body.ok, true);
    assert.equal(ok.body.idempotent, false);
    assert.equal(ok.body.reason, 'graceful_complete');

    const again = await agent
      .post(`/api/teleoperator/sessions/${sessionId}/end`)
      .send({ reason: 'operator_cancelled' })
      .expect(200);
    assert.equal(again.body.ok, true);
    assert.equal(again.body.idempotent, true);
    assert.equal(again.body.reason, 'graceful_complete');

    const row = await pool.query(`SELECT status FROM help_requests WHERE id = $1`, [helpId]);
    assert.equal(row.rows[0].status, 'closed');
  });

  test('POST sessions end 400 on invalid reason', async () => {
    await pool.query(
      'TRUNCATE help_request_operator_exclusions, teleop_sessions, help_requests, teleoperator_robot_grants, robots, teleoperators RESTART IDENTITY CASCADE',
    );
    await registry.loadFromPersistence();

    const reg = await registry.addRobot({
      host: '127.0.0.1',
      port: 65516,
      teleopSecret,
    });
    const h = await request(app)
      .post(`/api/robots/${reg.id}/teleop/help`)
      .set('X-Robot-Teleop-Secret', teleopSecret)
      .send({ message: 'x', metadata: {} })
      .expect(201);
    const agent = request.agent(app);
    const w = Keypair.generate().publicKey.toBase58();
    await agent
      .post('/api/teleoperator/register')
      .send({ login: 'badreason', password: 'password12', walletPublicKey: w })
      .expect(201);
    const acc = await agent.post(`/api/teleoperator/help-requests/${h.body.helpRequest.id}/accept`).expect(200);
    await pool.query(`UPDATE teleop_sessions SET robot_proxy_connected_at = NOW() WHERE id = $1`, [
      acc.body.session.id,
    ]);
    const r = await agent
      .post(`/api/teleoperator/sessions/${acc.body.session.id}/end`)
      .send({ reason: 'not_a_valid_reason' })
      .expect(400);
    assert.match(String(r.body.error || ''), /reason/i);
  });
});
