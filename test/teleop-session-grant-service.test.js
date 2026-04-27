const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { Keypair } = require('@solana/web3.js');
const { ed25519 } = require('@noble/curves/ed25519');
const bs58Module = require('bs58');
const bs58 = bs58Module.encode ? bs58Module : bs58Module.default;
const {
  createTeleopSessionGrantService,
  buildSessionGrantPayloadString,
} = require('../src/services/teleopSessionGrantService');

describe('teleopSessionGrantService', () => {
  test('buildSessionGrantPayloadString uses stable key order', () => {
    const s = buildSessionGrantPayloadString({
      sessionId: 'sid',
      robotId: 'rid',
      taskId: 'tid',
      operatorPubkey: 'op',
      validUntilSec: 99,
      scopeJson: '{"a":1}',
    });
    assert.equal(
      s,
      '{"operator_pubkey":"op","robot_id":"rid","scope_json":"{\\"a\\":1}","session_id":"sid","task_id":"tid","valid_until_sec":99}',
    );
  });

  test('signSessionGrant produces verifiable base58 Ed25519 signature', () => {
    const kp = Keypair.generate();
    const svc = createTeleopSessionGrantService({
      signingSecretKey: JSON.stringify(Array.from(kp.secretKey)),
      ttlSec: 120,
      operatorFlatPaymentSol: 0.0005,
    });
    assert.ok(svc.isConfigured());
    const op = Keypair.generate().publicKey.toBase58();
    const { teleopGrantPayload, teleopGrantSignature } = svc.signSessionGrant({
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      robotId: '660e8400-e29b-41d4-a716-446655440001',
      taskId: 't1',
      operatorWalletBase58: op,
    });
    const msg = new TextEncoder().encode(teleopGrantPayload);
    const sig = bs58.decode(teleopGrantSignature);
    assert.ok(ed25519.verify(sig, msg, kp.publicKey.toBytes()));
    const o = JSON.parse(teleopGrantPayload);
    assert.equal(o.operator_pubkey, op);
  });

  test('without signing key, isConfigured is false', () => {
    const svc = createTeleopSessionGrantService({ signingSecretKey: null });
    assert.equal(svc.isConfigured(), false);
  });
});
