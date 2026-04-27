const { test } = require('node:test');
const assert = require('node:assert/strict');
const { swaggerSpec } = require('../src/docs/swagger');

/**
 * Inventory: sprint checklist references DATA-node style APIs that are not part of task-router-x402.
 * This test locks the current OpenAPI surface so additions are intentional.
 */
test('OpenAPI: teleop help, session-grant, peaq claim documented', () => {
  const paths = swaggerSpec.paths || {};
  assert.ok(paths['/api/robots/{robotId}/teleop/help'], 'expected POST teleop/help');
  assert.ok(paths['/api/robots/{robotId}/teleop/session-grant'], 'expected GET session-grant');
  assert.ok(paths['/api/robots/{robotId}/peaq/claim'], 'expected GET peaq/claim');
  assert.ok(
    paths['/api/teleoperator/sessions/{sessionId}/decline-before-connect'],
    'expected POST teleoperator decline-before-connect',
  );
  assert.ok(paths['/api/teleoperator/sessions/{sessionId}/end'], 'expected POST teleoperator session end');
});

test('OpenAPI: sprint v1 receipts/incidents and per-robot KYR stats not in this service', () => {
  const keys = Object.keys(swaggerSpec.paths || {});
  assert.ok(!keys.some((k) => k.startsWith('/api/v1/receipts')), 'receipts API is out of scope for task-router-x402');
  assert.ok(!keys.some((k) => k.startsWith('/api/v1/incidents')), 'incidents API is out of scope for task-router-x402');
  assert.ok(
    !keys.some((k) => /\/api\/robots\/\{robotId\}\/stats\b/.test(k)),
    'GET /api/robots/{robotId}/stats (KYR stats) not implemented here',
  );
});
