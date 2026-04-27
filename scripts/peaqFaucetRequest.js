#!/usr/bin/env node
/**
 * Request test AGNG via Peaq’s official faucet API (same as the docs.peaq.xyz widget).
 * In the browser the call often fails: Cloudflare 524 (origin timeout) → response without CORS → "Failed to fetch" / CORS.
 * Node.js is not subject to CORS; only Peaq backend availability and latency matter.
 *
 * Usage:
 *   npm run peaq:faucet -- 0xYourEvmAddress
 *   PEAQ_FAUCET_ADDRESS=0x... npm run peaq:faucet
 *
 * Optional env:
 *   PEAQ_FAUCET_APIKEY — key from docs page source (APIKEY in widget script) if Peaq changes the embedded one.
 *   PEAQ_FAUCET_URL — POST URL (default dev-peaq-faucet-service.cisys.xyz/get-test-tokens).
 *   PEAQ_FAUCET_TIMEOUT_MS — request timeout in ms (default 180000).
 */

const { ethers } = require('ethers');

/** Public key from the embedded widget on docs.peaq.xyz (same as any client-side call). */
const DEFAULT_FAUCET_URL = 'https://dev-peaq-faucet-service.cisys.xyz/get-test-tokens';
const DEFAULT_API_KEY = '78b996ecb21a4a676078b99667606a6ae72d';

/**
 * @param {string} raw
 * @returns {string} checksum address
 */
function normalizeFaucetAddress(raw) {
  const s = String(raw || '').trim();
  if (!s) {
    throw new Error('EVM address required (arg or PEAQ_FAUCET_ADDRESS)');
  }
  try {
    return ethers.getAddress(s);
  } catch (e) {
    throw new Error(`Invalid EVM address: ${e.message}`);
  }
}

/**
 * @param {{ address: string, url?: string, apiKey?: string, timeoutMs?: number }} opts
 * @returns {Promise<{ ok: boolean, status: number, body: string, json?: object }>}
 */
async function requestPeaqTestTokens(opts) {
  const address = normalizeFaucetAddress(opts.address);
  const url = String(opts.url || process.env.PEAQ_FAUCET_URL || '').trim() || DEFAULT_FAUCET_URL;
  const apiKey = String(opts.apiKey || process.env.PEAQ_FAUCET_APIKEY || '').trim() || DEFAULT_API_KEY;
  const timeoutMs = Number(opts.timeoutMs ?? process.env.PEAQ_FAUCET_TIMEOUT_MS) || 180000;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        APIKEY: apiKey,
      },
      body: JSON.stringify({ address }),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(t);
    const name = e && e.name;
    const msg = e && e.message;
    if (name === 'AbortError') {
      throw new Error(
        `Request aborted after ${timeoutMs}ms (timeout). Peaq origin often hits Cloudflare 524 — try again later or ask Peaq Discord.`,
      );
    }
    throw new Error(msg || String(e));
  }
  clearTimeout(t);

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }

  return { ok: res.ok, status: res.status, body: text, json };
}

function print524Hint() {
  console.error('');
  console.error('Cloudflare 524 = origin server did not respond in time. Not a CORS issue from Node.');
  console.error('Report to Peaq (Discord / GitHub): faucet backend timeout + browser CORS on error pages.');
}

async function main() {
  const argv = process.argv.slice(2).filter((a) => a !== '--');
  const addr = argv[0] || process.env.PEAQ_FAUCET_ADDRESS;
  const url = process.env.PEAQ_FAUCET_URL || DEFAULT_FAUCET_URL;

  console.log('POST', url);
  console.log('address:', normalizeFaucetAddress(addr));

  const result = await requestPeaqTestTokens({ address: addr });

  if (result.status === 524) {
    console.error('HTTP 524 (Cloudflare timeout).');
    print524Hint();
    process.exit(1);
  }

  if (!result.ok) {
    console.error('HTTP', result.status);
    console.error(result.body.slice(0, 2000));
    if (result.status >= 500) {
      print524Hint();
    }
    process.exit(1);
  }

  console.log('OK', result.json != null ? JSON.stringify(result.json, null, 2) : result.body);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}

module.exports = {
  normalizeFaucetAddress,
  requestPeaqTestTokens,
  DEFAULT_FAUCET_URL,
};
