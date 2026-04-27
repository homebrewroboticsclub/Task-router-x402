const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pushOperatorAllowlistToRobot } = require('../src/services/robotOperatorSync');

test('pushOperatorAllowlistToRobot skips without operatorRegistryUrl', async () => {
  const r = await pushOperatorAllowlistToRobot({
    robot: { id: 'x' },
    raidToRobotSecret: 'sec',
    allowedTeleoperatorIds: ['a'],
  });
  assert.equal(r.skipped, true);
  assert.match(String(r.reason || ''), /operator_registry_url/i);
});

test('pushOperatorAllowlistToRobot skips without RAID_TO_ROBOT_SECRET', async () => {
  const r = await pushOperatorAllowlistToRobot({
    robot: { id: 'x', operatorRegistryUrl: 'http://127.0.0.1:9/nope' },
    raidToRobotSecret: null,
    allowedTeleoperatorIds: [],
  });
  assert.equal(r.skipped, true);
});
