const { describe, test, before } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');
const path = require('path');
const createAdminRouter = require('../src/routes/admin');
const { createAdminUiGuardMiddleware } = require('../src/middleware/adminAuth');

describe('admin HTTP', () => {
  let app;
  const adminConfig = {
    username: 'admtest',
    password: 'secretpass',
    sessionSecret: 'admin-test-jwt-secret',
    jwtExpiresIn: '1h',
    cookieName: 'admin_session',
    cookieSecureMode: 'never',
  };

  before(() => {
    app = express();
    app.use(cookieParser());
    app.use(express.json());
    app.use(
      '/api/admin',
      createAdminRouter({
        adminConfig,
        settingsStore: {
          getSettings: () => ({}),
          saveSettings: () => ({ rpcProvider: 'public' }),
        },
      }),
    );
  });

  test('GET /session without cookie', async () => {
    const res = await request(app).get('/api/admin/session').expect(200);
    assert.equal(res.body.authenticated, false);
  });

  test('POST /login rejects bad password', async () => {
    await request(app)
      .post('/api/admin/login')
      .send({ username: 'admtest', password: 'wrong' })
      .expect(401);
  });

  test('POST /login rejects non-string credentials with 400', async () => {
    await request(app)
      .post('/api/admin/login')
      .send({ username: 'admtest', password: 123 })
      .expect(400);
    await request(app).post('/api/admin/login').send({}).expect(400);
  });

  test('POST /login sets cookie; GET /ai-agent with cookie', async () => {
    const agent = request.agent(app);
    const login = await agent
      .post('/api/admin/login')
      .send({ username: 'admtest', password: 'secretpass' })
      .expect(200);
    assert.equal(login.body.ok, true);
    assert.match(String(login.headers['set-cookie'] || ''), /admin_session=/);

    const ai = await agent.get('/api/admin/ai-agent').expect(200);
    assert.ok(typeof ai.body === 'object');
  });

  test('GET /ai-agent without auth returns 401', async () => {
    await request(app).get('/api/admin/ai-agent').expect(401);
  });

  test('GET /ai-agent with Basic Auth', async () => {
    const auth = Buffer.from('admtest:secretpass').toString('base64');
    const res = await request(app)
      .get('/api/admin/ai-agent')
      .set('Authorization', `Basic ${auth}`)
      .expect(200);
    assert.ok(typeof res.body === 'object');
  });

  test('GET /services-registration with session', async () => {
    const adminApp = express();
    adminApp.use(cookieParser());
    adminApp.use(express.json());
    adminApp.use(
      '/api/admin',
      createAdminRouter({
        adminConfig,
        config: {
          dataNodeSyncFleet: {
            provisionEnabled: false,
            baseUrl: null,
            batchPath: '/v1/ingest/robot-events',
            enabled: false,
            intervalSec: 300,
            authHeaderName: 'Authorization',
            authHeaderValue: null,
            includeDashboardEvents: true,
            includeAuditEvents: true,
            includeStateUsbSnapshot: true,
            includeKyrIncidents: true,
          },
          robots: { raidToRobotSecret: null, fleetEnrollmentSecret: null },
          dataNodeIncidentRelay: { enabled: false, url: '', method: 'POST', authHeader: null, authValue: null },
        },
        settingsStore: {
          getSettings: () => ({}),
          saveSettings: () => ({ rpcProvider: 'public' }),
        },
      }),
    );
    const agent = request.agent(adminApp);
    await agent
      .post('/api/admin/login')
      .send({ username: 'admtest', password: 'secretpass' })
      .expect(200);
    const res = await agent.get('/api/admin/services-registration').expect(200);
    assert.ok(res.body.effectiveDataNodeSyncFleet);
    assert.equal(res.body.raidToRobotSecretFromEnv, false);
  });

  test('POST /logout clears session', async () => {
    const agent = request.agent(app);
    await agent
      .post('/api/admin/login')
      .send({ username: 'admtest', password: 'secretpass' })
      .expect(200);
    await agent.post('/api/admin/logout').expect(200);
    await agent.get('/api/admin/ai-agent').expect(401);
  });

  test('UI guard redirects except login and styles', async () => {
    const uiApp = express();
    uiApp.use(cookieParser());
    uiApp.use(
      '/ui',
      createAdminUiGuardMiddleware(adminConfig),
      (req, res) => {
        res.type('html').send('ok');
      },
    );
    const redir = await request(uiApp).get('/ui/app.js').expect(302);
    assert.match(String(redir.headers.location), /\/ui\/login\.html/);
    await request(uiApp).get('/ui/login.html').expect(200);
    await request(uiApp).get('/ui/styles.css').expect(200);
  });

  test('GET /ui/ without session redirects to login, not to itself (no 302 loop)', async () => {
    const uiApp = express();
    uiApp.use(cookieParser());
    uiApp.use(
      '/ui',
      createAdminUiGuardMiddleware(adminConfig),
      express.static(path.join(__dirname, '../public')),
    );
    const res = await request(uiApp).get('/ui/').redirects(0).expect(302);
    const loc = String(res.headers.location || '');
    assert.notEqual(loc, '/ui/', 'must not redirect /ui/ → /ui/ (Express 5 matches /ui and /ui/ for the same route)');
    assert.match(loc, /login\.html/);
  });
});
