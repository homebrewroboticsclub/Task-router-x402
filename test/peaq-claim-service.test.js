const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createPeaqClaimService } = require('../src/services/peaqClaimService');

describe('createPeaqClaimService', () => {
  test('buildFailureClaim includes raid_peaq_read_status failed', () => {
    const svc = createPeaqClaimService({
      enabled: true,
      httpBaseUrl: 'https://h',
      wssBaseUrl: 'wss://w',
      machineDidName: 'n',
      machineEvmAddress: `0x${'a'.repeat(40)}`,
      networkLabel: 'peaq-agung',
    });
    const c = svc.buildFailureClaim({
      helpRequestId: '00000000-0000-4000-8000-0000000000aa',
      robotId: '00000000-0000-4000-8000-0000000000bb',
      errorMessage: 'upstream timeout',
    });
    assert.equal(c.raid_peaq_read_status, 'failed');
    assert.match(String(c.raid_peaq_error || ''), /upstream timeout/i);
    assert.equal(c.help_request_id, '00000000-0000-4000-8000-0000000000aa');
    assert.equal(c.robot_id, '00000000-0000-4000-8000-0000000000bb');
  });
});
