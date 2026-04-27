const { describe, test, before } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const createRobotsRouter = require('../src/routes/robots');
const RobotRegistry = require('../src/services/robotRegistry');
const createHealthMonitor = require('../src/services/healthMonitor');
const X402Service = require('../src/services/x402Service');
const { loadConfig } = require('../src/config');

describe('robots HTTP', () => {
  let app;
  let registry;
  let config;
  const fleetSecret = 'test-fleet-secret-robots-http';

  before(() => {
    process.env.ROBOT_FLEET_ENROLLMENT_SECRET = fleetSecret;
    process.env.ROBOT_HEALTH_TIMEOUT_MS = '400';
    config = loadConfig([]);
    const x402Service = new X402Service(config.x402);
    const healthMonitor = createHealthMonitor({ config, x402Service });
    registry = new RobotRegistry({ healthMonitor });
    app = express();
    app.use(express.json());
    app.use(
      '/api/robots',
      createRobotsRouter({
        registry,
        config,
        adminConfig: config.admin,
      }),
    );
  });

  test('GET /api/robots returns empty list initially', async () => {
    const res = await request(app).get('/api/robots').expect(200);
    assert.deepEqual(res.body, { robots: [] });
  });

  test('GET /api/robots does not expose teleopSecret', async () => {
    const secret = 'hidden-from-public-get';
    await registry.addRobot({
      name: 'test1',
      host: '127.0.0.1',
      port: 65533,
      teleopSecret: secret,
    });

    const res = await request(app).get('/api/robots').expect(200);
    assert.equal(res.body.robots.length, 1);
    const r = res.body.robots[0];
    assert.equal(r.teleopSecret, undefined);
    assert.equal(r.name, 'test1');
    assert.ok(r.status && typeof r.status.state === 'string');
  });

  test('POST /api/robots without auth returns 401', async () => {
    await request(app)
      .post('/api/robots')
      .send({ host: '1.1.1.1', port: 1 })
      .expect(401);
  });

  test('POST /api/robots with fleet Bearer creates robot with teleopSecret in response', async () => {
    const res = await request(app)
      .post('/api/robots')
      .set('Authorization', `Bearer ${fleetSecret}`)
      .send({ host: '127.0.0.1', port: 49152, teleopSecret: 't1' })
      .expect(201);
    assert.equal(res.body.teleopSecret, 't1');
    assert.ok(res.body.id);
  });

  test('POST /api/robots/enroll requires fleet secret and upserts by enrollmentKey', async () => {
    const r1 = await request(app)
      .post('/api/robots/enroll')
      .set('X-Robot-Fleet-Secret', fleetSecret)
      .send({
        enrollmentKey: 'device-abc',
        host: '127.0.0.1',
        port: 49153,
        name: 'Bot A',
      })
      .expect(200);
    const id1 = r1.body.id;
    assert.ok(r1.body.teleopSecret);

    const r2 = await request(app)
      .post('/api/robots/enroll')
      .set('Authorization', `Bearer ${fleetSecret}`)
      .send({
        enrollmentKey: 'device-abc',
        host: '127.0.0.1',
        port: 49154,
        name: 'Bot A renamed',
      })
      .expect(200);
    assert.equal(r2.body.id, id1);
    assert.equal(r2.body.host, '127.0.0.1');
    assert.equal(r2.body.port, 49154);
  });
});
