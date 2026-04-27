const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../src/config');

describe('teleop config env', () => {
  const backup = {};

  beforeEach(() => {
    const keys = [
      'TELEOP_SESSION_END_GRACE_MS',
      'TELEOP_ROSBRIDGE_CONNECT_ATTEMPTS',
      'TELEOP_ROSBRIDGE_RECONNECT_DELAY_MS',
      'TELEOP_ROSBRIDGE_DROP_RECONNECT_ATTEMPTS',
      'TELEOP_GRANT_SIGNING_SECRET_KEY',
      'TELEOP_GRANT_TTL_SEC',
      'TELEOP_OPERATOR_FLAT_SOL',
      'ANY_TELEOP_HTTP_PATH',
      'ANY_TELEOP_FIXED_SOL',
    ];
    keys.forEach((k) => {
      backup[k] = process.env[k];
      delete process.env[k];
    });
    // loadConfig() calls loadEnvFile: deleted keys may be re-applied from .env in cwd.
    // Empty string is not overwritten from file and yields grantSigningSecretKey: null in config.
    process.env.TELEOP_GRANT_SIGNING_SECRET_KEY = '';
  });

  afterEach(() => {
    Object.keys(backup).forEach((k) => {
      if (backup[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = backup[k];
      }
    });
  });

  test('teleop session/rosbridge options are numeric (defaults or .env)', () => {
    const c = loadConfig([]);
    assert.ok(Number.isFinite(c.teleop.sessionEndGraceMs) && c.teleop.sessionEndGraceMs >= 0);
    assert.ok(Number.isFinite(c.teleop.rosbridgeConnectAttempts) && c.teleop.rosbridgeConnectAttempts >= 1);
    assert.ok(Number.isFinite(c.teleop.rosbridgeReconnectDelayMs) && c.teleop.rosbridgeReconnectDelayMs >= 0);
    assert.ok(
      Number.isFinite(c.teleop.rosbridgeDropReconnectAttempts)
        && c.teleop.rosbridgeDropReconnectAttempts >= 0,
    );
    assert.equal(c.teleop.operatorFlatPaymentSol, 0.0005);
    assert.equal(c.teleop.anyTeleopFixedSol, 0.0005);
    assert.equal(c.teleop.anyTeleopHttpPath, '/x402/any_teleop');
    assert.equal(c.teleop.grantSigningSecretKey, null);
    assert.equal(c.teleop.grantTtlSec, 86400);
  });

  test('env overrides', () => {
    process.env.TELEOP_SESSION_END_GRACE_MS = '60000';
    process.env.TELEOP_ROSBRIDGE_CONNECT_ATTEMPTS = '5';
    process.env.TELEOP_ROSBRIDGE_RECONNECT_DELAY_MS = '500';
    process.env.TELEOP_ROSBRIDGE_DROP_RECONNECT_ATTEMPTS = '2';
    const c = loadConfig([]);
    assert.equal(c.teleop.sessionEndGraceMs, 60000);
    assert.equal(c.teleop.rosbridgeConnectAttempts, 5);
    assert.equal(c.teleop.rosbridgeReconnectDelayMs, 500);
    assert.equal(c.teleop.rosbridgeDropReconnectAttempts, 2);
  });
});

describe('peaq config env', () => {
  const backup = {};

  beforeEach(() => {
    const keys = [
      'PEAQ_ENABLED',
      'PEAQ_HTTP_BASE_URL',
      'PEAQ_WSS_BASE_URL',
      'PEAQ_MACHINE_DID_NAME',
      'PEAQ_MACHINE_EVM_ADDRESS',
      'PEAQ_NETWORK',
      'PEAQ_CLAIM_SYNC_TIMEOUT_MS',
    ];
    keys.forEach((k) => {
      backup[k] = process.env[k];
      delete process.env[k];
    });
  });

  afterEach(() => {
    Object.keys(backup).forEach((k) => {
      if (backup[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = backup[k];
      }
    });
  });

  test('peaq Agung RPC defaults when PEAQ_ENABLED and HTTP/WSS unset', () => {
    process.env.PEAQ_ENABLED = 'true';
    process.env.PEAQ_MACHINE_DID_NAME = 'test_did';
    process.env.PEAQ_MACHINE_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';
    const c = loadConfig([]);
    assert.equal(c.peaq.httpBaseUrl, 'https://peaq-agung.api.onfinality.io/public');
    assert.equal(c.peaq.wssBaseUrl, 'wss://wss-async.agung.peaq.network');
    assert.equal(c.peaq.machineDidName, 'test_did');
  });

  test('peaq HTTP/WSS explicit env overrides defaults', () => {
    process.env.PEAQ_ENABLED = 'true';
    process.env.PEAQ_HTTP_BASE_URL = 'https://custom.rpc.example/public';
    process.env.PEAQ_WSS_BASE_URL = 'wss://custom.wss.example';
    process.env.PEAQ_MACHINE_DID_NAME = 'n';
    process.env.PEAQ_MACHINE_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';
    const c = loadConfig([]);
    assert.equal(c.peaq.httpBaseUrl, 'https://custom.rpc.example/public');
    assert.equal(c.peaq.wssBaseUrl, 'wss://custom.wss.example');
  });

  test('peaq HTTP/WSS null when PEAQ_ENABLED false and unset', () => {
    // Explicitly off: cwd may have .env with PEAQ_ENABLED=true (loadEnvFile merges into process.env).
    process.env.PEAQ_ENABLED = 'false';
    const c = loadConfig([]);
    assert.equal(c.peaq.enabled, false);
    assert.equal(c.peaq.httpBaseUrl, null);
    assert.equal(c.peaq.wssBaseUrl, null);
  });
});
