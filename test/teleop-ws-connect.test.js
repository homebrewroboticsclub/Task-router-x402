const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { openRosbridgeOnce, openRosbridgeWithRetries } = require('../src/ws/teleopServer');

describe('openRosbridge WebSocket helpers', () => {
  test('openRosbridgeOnce connects to a local ws server', async () => {
    const server = new WebSocket.Server({ port: 0, host: '127.0.0.1' });
    await new Promise((resolve) => server.once('listening', resolve));
    const port = server.address().port;

    const client = await openRosbridgeOnce(`ws://127.0.0.1:${port}`, null, 3000);
    assert.equal(client.readyState, 1);
    client.close();
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  test('openRosbridgeWithRetries uses multiple attempts', async () => {
    const server = new WebSocket.Server({ port: 0, host: '127.0.0.1' });
    await new Promise((resolve) => server.once('listening', resolve));
    const port = server.address().port;

    const client = await openRosbridgeWithRetries(`ws://127.0.0.1:${port}`, null, 2000, 2, 10);
    assert.equal(client.readyState, 1);
    client.close();
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });
});
