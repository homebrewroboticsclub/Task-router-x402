const { Keypair } = require('@solana/web3.js');
const { ed25519 } = require('@noble/curves/ed25519');
const bs58Module = require('bs58');
const SolanaDirectPaymentProvider = require('./payments/solanaDirectProvider');

const bs58 = bs58Module.encode ? bs58Module : bs58Module.default;

/**
 * Deterministic SessionGrant JSON (variant A payload) — stable key order for signing.
 * @param {{
 *   sessionId: string,
 *   robotId: string,
 *   taskId: string,
 *   operatorPubkey: string,
 *   validUntilSec: number,
 *   scopeJson: string — value for SessionGrant field scope_json (JSON string)
 * }} fields
 */
function buildSessionGrantPayloadString(fields) {
  const obj = {
    operator_pubkey: fields.operatorPubkey,
    robot_id: fields.robotId,
    scope_json: fields.scopeJson,
    session_id: fields.sessionId,
    task_id: fields.taskId,
    valid_until_sec: fields.validUntilSec,
  };
  return JSON.stringify(obj);
}

/**
 * @param {object} options
 * @param {string | null | undefined} options.signingSecretKey
 * @param {number} [options.ttlSec]
 * @param {number} [options.operatorFlatPaymentSol]
 */
function createTeleopSessionGrantService({
  signingSecretKey,
  ttlSec = 86400,
  operatorFlatPaymentSol = 0.0005,
} = {}) {
  let keypair = null;
  if (signingSecretKey && String(signingSecretKey).trim()) {
    try {
      const raw = SolanaDirectPaymentProvider.parseSecretKey(String(signingSecretKey).trim());
      keypair = raw.byteLength === 64 ? Keypair.fromSecretKey(raw) : Keypair.fromSeed(raw);
    } catch {
      keypair = null;
    }
  }

  function isConfigured() {
    return Boolean(keypair);
  }

  function signerPublicKeyBase58() {
    return keypair ? keypair.publicKey.toBase58() : null;
  }

  function buildScopeJson() {
    return JSON.stringify({
      allowed_actions: ['*'],
      teleop_operator_flat_sol: operatorFlatPaymentSol,
      teleop_payment_mode: 'flat',
    });
  }

  /**
   * @param {{
   *   sessionId: string,
   *   robotId: string,
   *   taskId: string,
   *   operatorWalletBase58: string,
   * }} input
   * @returns {{ teleopGrantPayload: string, teleopGrantSignature: string }}
   */
  function signSessionGrant(input) {
    if (!keypair) {
      throw new Error('Teleop grant signing is not configured');
    }
    const nowSec = Math.floor(Date.now() / 1000);
    const validUntilSec = nowSec + Math.max(60, Number(ttlSec) || 86400);
    const scopeJson = buildScopeJson();
    const teleopGrantPayload = buildSessionGrantPayloadString({
      sessionId: input.sessionId,
      robotId: input.robotId,
      taskId: input.taskId || '',
      operatorPubkey: input.operatorWalletBase58,
      validUntilSec,
      scopeJson,
    });
    const msg = new TextEncoder().encode(teleopGrantPayload);
    const sig = ed25519.sign(msg, keypair.secretKey.slice(0, 32));
    const teleopGrantSignature = bs58.encode(sig);
    return { teleopGrantPayload, teleopGrantSignature };
  }

  return {
    isConfigured,
    signerPublicKeyBase58,
    buildScopeJson,
    signSessionGrant,
  };
}

module.exports = {
  createTeleopSessionGrantService,
  buildSessionGrantPayloadString,
};
