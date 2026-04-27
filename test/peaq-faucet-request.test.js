const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeFaucetAddress, DEFAULT_FAUCET_URL } = require('../scripts/peaqFaucetRequest');

describe('peaqFaucetRequest (unit)', () => {
  test('normalizeFaucetAddress checksum (EIP-55)', () => {
    const once = normalizeFaucetAddress('0x899586d336f01635f4c4eed2c25b5b38e7558b55');
    assert.equal(normalizeFaucetAddress(once.toLowerCase()), once);
  });

  test('normalizeFaucetAddress rejects empty', () => {
    assert.throws(() => normalizeFaucetAddress(''), /required/i);
  });

  test('DEFAULT_FAUCET_URL is https cisys faucet', () => {
    assert.ok(DEFAULT_FAUCET_URL.startsWith('https://'));
    assert.ok(DEFAULT_FAUCET_URL.includes('get-test-tokens'));
  });
});
