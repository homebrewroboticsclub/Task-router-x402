const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { pushRobotProvisionToRobot } = require('../src/services/robotOperatorSync');

function listenServer(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

test('pushRobotProvisionToRobot sends combined body', async () => {
  /** @type {unknown} */
  let received = null;
  const server = await listenServer((req, res) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
    });
    req.on('end', () => {
      received = JSON.parse(raw);
      res.writeHead(200);
      res.end('{}');
    });
  });
  try {
    const { port } = /** @type {import('net').AddressInfo} */ (server.address());
    const robot = { id: 'r1', operatorRegistryUrl: `http://127.0.0.1:${port}/sync` };
    const r = await pushRobotProvisionToRobot({
      robot,
      raidToRobotSecret: 'sec',
      allowedTeleoperatorIds: ['a', 'b'],
      dataNodeSync: { baseUrl: 'https://x.test', raidRobotUuid: 'r1' },
      pushAllowlist: true,
      pushDataNodeSync: true,
    });
    assert.equal(r.ok, true);
    assert.deepEqual(received?.allowedTeleoperatorIds, ['a', 'b']);
    assert.equal(received?.dataNodeSync?.baseUrl, 'https://x.test');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('pushRobotProvisionToRobot allowlist-only omits dataNodeSync key', async () => {
  /** @type {Record<string, unknown>|null} */
  let received = null;
  const server = await listenServer((req, res) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
    });
    req.on('end', () => {
      received = JSON.parse(raw);
      res.writeHead(200);
      res.end('{}');
    });
  });
  try {
    const { port } = /** @type {import('net').AddressInfo} */ (server.address());
    const robot = { id: 'r1', operatorRegistryUrl: `http://127.0.0.1:${port}/sync` };
    await pushRobotProvisionToRobot({
      robot,
      raidToRobotSecret: 'sec',
      allowedTeleoperatorIds: ['x'],
      dataNodeSync: { baseUrl: 'https://x.test' },
      pushAllowlist: true,
      pushDataNodeSync: false,
    });
    assert.deepEqual(received?.allowedTeleoperatorIds, ['x']);
    assert.equal(Object.prototype.hasOwnProperty.call(received || {}, 'dataNodeSync'), false);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('pushRobotProvisionToRobot sync-only omits allowedTeleoperatorIds', async () => {
  /** @type {Record<string, unknown>|null} */
  let received = null;
  const server = await listenServer((req, res) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
    });
    req.on('end', () => {
      received = JSON.parse(raw);
      res.writeHead(200);
      res.end('{}');
    });
  });
  try {
    const { port } = /** @type {import('net').AddressInfo} */ (server.address());
    const robot = { id: 'r1', operatorRegistryUrl: `http://127.0.0.1:${port}/sync` };
    await pushRobotProvisionToRobot({
      robot,
      raidToRobotSecret: 'sec',
      allowedTeleoperatorIds: [],
      dataNodeSync: { baseUrl: 'https://y.test', raidRobotUuid: 'r1' },
      pushAllowlist: false,
      pushDataNodeSync: true,
    });
    assert.equal(Object.prototype.hasOwnProperty.call(received || {}, 'allowedTeleoperatorIds'), false);
    assert.equal(received?.dataNodeSync?.baseUrl, 'https://y.test');
  } finally {
    await new Promise((r) => server.close(r));
  }
});
