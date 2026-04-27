#!/usr/bin/env node
/**
 * Onboard a machine DID on Peaq Agung (EVM): sdk.did.create + Sdk.sendEvmTx.
 * Standalone test/ops module; logic can later be invoked from robot enroll.
 *
 * Requires a wallet with test PEAQ on Agung for gas (faucet: see docs.peaq.xyz).
 *
 * Usage:
 *   npm run peaq:onboard
 *   PEAQ_ONBOARD_EVM_PRIVATE_KEY=0x... npm run peaq:onboard
 *   node scripts/peaqOnboardMachine.js --dry-run
 *
 * Env:
 *   PEAQ_ONBOARD_EVM_PRIVATE_KEY — private key (0x… or hex without 0x) or mnemonic (never commit).
 *   PEAQ_ONBOARD_MACHINE_NAME — optional; otherwise generated raid_m_<random hex>.
 *   PEAQ_HTTP_BASE_URL, PEAQ_WSS_BASE_URL — optional (Agung defaults from src/config.js).
 *
 * On success copy into Task Router `.env`: PEAQ_MACHINE_DID_NAME, PEAQ_MACHINE_EVM_ADDRESS.
 */

const crypto = require('crypto');
const path = require('path');
const dotenv = require('dotenv');

const { Sdk } = require('@peaq-network/sdk');
const { ethers } = require('ethers');
const { PEAQ_AGUNG_HTTP_DEFAULT, PEAQ_AGUNG_WSS_DEFAULT } = require('../src/config');

const ENV_PATH = path.join(__dirname, '..', '.env');
try {
  dotenv.config({ path: ENV_PATH });
} catch {
  /* optional .env */
}

/**
 * @returns {string}
 */
function buildDefaultMachineName() {
  return `raid_m_${crypto.randomBytes(5).toString('hex')}`;
}

/**
 * @param {string|undefined} input
 * @returns {string}
 */
function sanitizeMachineName(input) {
  if (input == null || String(input).trim() === '') {
    return buildDefaultMachineName();
  }
  const t = String(input)
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^_+/, '')
    .slice(0, 48);
  return t || buildDefaultMachineName();
}

/**
 * @param {{ privateKey: string, machineName?: string, httpBaseUrl?: string, wssBaseUrl?: string }} opts
 * @returns {Promise<{ machineName: string, evmAddress: string, txHash: string }>}
 */
async function onboardPeaqMachine(opts) {
  const privateKey = String(opts.privateKey || '').trim();
  if (!privateKey) {
    throw new Error('privateKey is required (set PEAQ_ONBOARD_EVM_PRIVATE_KEY)');
  }

  const httpBaseUrl = String(opts.httpBaseUrl || process.env.PEAQ_HTTP_BASE_URL || '').trim() || PEAQ_AGUNG_HTTP_DEFAULT;
  const wssBaseUrl = String(opts.wssBaseUrl || process.env.PEAQ_WSS_BASE_URL || '').trim() || PEAQ_AGUNG_WSS_DEFAULT;
  const machineName = sanitizeMachineName(opts.machineName || process.env.PEAQ_ONBOARD_MACHINE_NAME);

  let wallet;
  try {
    wallet = new ethers.Wallet(privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`);
  } catch {
    try {
      wallet = ethers.Wallet.fromPhrase(privateKey);
    } catch (e2) {
      throw new Error(`Invalid PEAQ_ONBOARD_EVM_PRIVATE_KEY: ${e2.message}`);
    }
  }
  const address = wallet.address;

  const sdk = await Sdk.createInstance({
    baseUrl: httpBaseUrl,
    chainType: Sdk.ChainType.EVM,
  });

  try {
    const tx = await sdk.did.create({
      name: machineName,
      address,
    });

    const receipt = await Sdk.sendEvmTx({
      tx,
      baseUrl: httpBaseUrl,
      seed: privateKey.startsWith('0x') || privateKey.includes(' ') ? privateKey : `0x${privateKey}`,
    });

    const txHash = receipt && receipt.hash ? receipt.hash : String(receipt);

    return { machineName, evmAddress: address, txHash };
  } finally {
    if (sdk && typeof sdk.disconnect === 'function') {
      try {
        await sdk.disconnect();
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * @param {{ machineName: string, evmAddress: string, httpBaseUrl?: string, wssBaseUrl?: string }} opts
 * @returns {Promise<object>}
 */
async function readDidSmokeTest(opts) {
  const httpBaseUrl = String(opts.httpBaseUrl || process.env.PEAQ_HTTP_BASE_URL || '').trim() || PEAQ_AGUNG_HTTP_DEFAULT;
  const wssBaseUrl = String(opts.wssBaseUrl || process.env.PEAQ_WSS_BASE_URL || '').trim() || PEAQ_AGUNG_WSS_DEFAULT;

  const sdk = await Sdk.createInstance({
    baseUrl: httpBaseUrl,
    chainType: Sdk.ChainType.EVM,
  });
  try {
    return await sdk.did.read({
      name: opts.machineName,
      address: opts.evmAddress,
      wssBaseUrl,
    });
  } finally {
    if (sdk && typeof sdk.disconnect === 'function') {
      try {
        await sdk.disconnect();
      } catch {
        /* ignore */
      }
    }
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');

  if (dryRun) {
    const name = sanitizeMachineName(process.env.PEAQ_ONBOARD_MACHINE_NAME);
    console.log('[peaq onboard dry-run] machine name (no tx):', name);
    console.log('Set PEAQ_ONBOARD_EVM_PRIVATE_KEY and run without --dry-run to submit on-chain.');
    process.exit(0);
  }

  const pk = process.env.PEAQ_ONBOARD_EVM_PRIVATE_KEY;
  if (!pk || !String(pk).trim()) {
    console.error('Missing PEAQ_ONBOARD_EVM_PRIVATE_KEY (Agung-funded wallet).');
    console.error('Dry-run: node scripts/peaqOnboardMachine.js --dry-run');
    process.exit(1);
  }

  console.log('[peaq onboard] HTTP RPC:', process.env.PEAQ_HTTP_BASE_URL || PEAQ_AGUNG_HTTP_DEFAULT);
  const result = await onboardPeaqMachine({
    privateKey: pk,
    machineName: process.env.PEAQ_ONBOARD_MACHINE_NAME,
  });
  console.log('[peaq onboard] OK');
  console.log('  PEAQ_MACHINE_DID_NAME=', result.machineName);
  console.log('  PEAQ_MACHINE_EVM_ADDRESS=', result.evmAddress);
  console.log('  tx hash:', result.txHash);
  console.log('');
  console.log('Paste into Task Router .env (with PEAQ_ENABLED=true).');

  try {
    const doc = await readDidSmokeTest({
      machineName: result.machineName,
      evmAddress: result.evmAddress,
    });
    console.log('[peaq onboard] did.read OK, document id:', doc && doc.document && doc.document.id);
  } catch (e) {
    console.warn('[peaq onboard] did.read verify skipped:', e.message);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[peaq onboard] FAILED:', err.message || err);
    process.exit(1);
  });
}

module.exports = {
  onboardPeaqMachine,
  readDidSmokeTest,
  buildDefaultMachineName,
  sanitizeMachineName,
  PEAQ_AGUNG_HTTP_DEFAULT,
  PEAQ_AGUNG_WSS_DEFAULT,
};
