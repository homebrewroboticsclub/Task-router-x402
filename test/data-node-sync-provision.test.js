const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildDataNodeSyncForRobot,
  clampIntervalSec,
  buildDataNodeSyncFromRobot,
  INTERVAL_MIN,
  INTERVAL_MAX,
} = require('../src/services/dataNodeSyncProvision');

test('clampIntervalSec clamps to 60–86400', () => {
  assert.equal(clampIntervalSec(30, 300), INTERVAL_MIN);
  assert.equal(clampIntervalSec(100000, 300), INTERVAL_MAX);
  assert.equal(clampIntervalSec(120, 300), 120);
});

test('buildDataNodeSyncForRobot returns null without baseUrl after merge', () => {
  assert.equal(
    buildDataNodeSyncForRobot({
      robotId: '550e8400-e29b-41d4-a716-446655440000',
      fleetPartial: {},
      overridePartial: null,
    }),
    null,
  );
});

test('buildDataNodeSyncForRobot sets raidRobotUuid and omits empty authHeaderValue', () => {
  const rid = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
  const out = buildDataNodeSyncForRobot({
    robotId: rid,
    fleetPartial: { baseUrl: 'https://dn.example', batchPath: '/v1/ingest/robot-events' },
    overridePartial: { authHeaderValue: '' },
  });
  assert.ok(out);
  assert.equal(out.raidRobotUuid, rid);
  assert.equal(out.baseUrl, 'https://dn.example');
  assert.equal(Object.prototype.hasOwnProperty.call(out, 'authHeaderValue'), false);
});

test('buildDataNodeSyncForRobot includes authHeaderValue when non-empty', () => {
  const out = buildDataNodeSyncForRobot({
    robotId: '550e8400-e29b-41d4-a716-446655440000',
    fleetPartial: { baseUrl: 'https://a.test' },
    overridePartial: { authHeaderValue: 'Bearer x' },
  });
  assert.equal(out.authHeaderValue, 'Bearer x');
});

test('buildDataNodeSyncFromRobot uses override-only when fleet disabled', () => {
  const robot = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    dataNodeSyncOverride: { baseUrl: 'https://only-override.test', intervalSec: 120 },
  };
  const config = {
    dataNodeSyncFleet: { provisionEnabled: false, baseUrl: null },
  };
  const out = buildDataNodeSyncFromRobot(robot, config);
  assert.ok(out);
  assert.equal(out.baseUrl, 'https://only-override.test');
  assert.equal(out.intervalSec, 120);
});
