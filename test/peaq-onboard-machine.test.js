const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildDefaultMachineName,
  sanitizeMachineName,
  onboardPeaqMachine,
  PEAQ_AGUNG_HTTP_DEFAULT,
} = require('../scripts/peaqOnboardMachine');

describe('peaq onboard machine script (unit)', () => {
  test('buildDefaultMachineName matches raid_m_<hex>', () => {
    const n = buildDefaultMachineName();
    assert.match(n, /^raid_m_[a-f0-9]{10}$/);
  });

  test('sanitizeMachineName generates default when empty', () => {
    const n = sanitizeMachineName('');
    assert.match(n, /^raid_m_[a-f0-9]{10}$/);
  });

  test('sanitizeMachineName strips invalid chars', () => {
    assert.equal(sanitizeMachineName('ab-cd'), 'ab_cd');
  });

  test('onboardPeaqMachine rejects missing private key', async () => {
    await assert.rejects(() => onboardPeaqMachine({ privateKey: '' }), /privateKey is required/i);
  });

  test('Agung default HTTP constant is https', () => {
    assert.ok(PEAQ_AGUNG_HTTP_DEFAULT.startsWith('https://'));
  });
});
