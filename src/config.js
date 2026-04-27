const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const logger = require('./utils/logger');

/**
 * Load `.env` without overwriting existing process.env (same as default dotenv).
 * Strips UTF-8 BOM if present — otherwise the first key (often ADMIN_*) is ignored by the parser.
 */
const loadEnvFile = () => {
  const explicitPath = process.env.DOTENV_CONFIG_PATH;
  const envPath = explicitPath || path.join(process.cwd(), '.env');
  try {
    if (!fs.existsSync(envPath)) {
      logger.debug('No .env file at cwd (using process.env only)', { envPath });
      return;
    }
    let raw = fs.readFileSync(envPath, 'utf8');
    if (raw.charCodeAt(0) === 0xfeff) {
      raw = raw.slice(1);
      logger.warn('Removed UTF-8 BOM from .env (first variable names were ignored by the parser before)');
    }
    const parsed = dotenv.parse(raw);
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
    logger.debug('Environment configuration loaded', { envPath });
  } catch (error) {
    logger.warn('Failed to load environment configuration file', { error: error.message });
  }
};

const parseArgs = (rawArgs = []) => {
  const args = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const token = rawArgs[index];
    if (token === '--') {
      continue;
    }

    if (!token.startsWith('--')) {
      continue;
    }

    const [keyPart, ...valueParts] = token.slice(2).split('=');
    if (valueParts.length > 0) {
      const value = valueParts.join('=');
      args[keyPart] = value.replace(/^"(.*)"$/, '$1');
      continue;
    }

    const nextToken = rawArgs[index + 1];
    if (nextToken && !nextToken.startsWith('--')) {
      args[keyPart] = nextToken.replace(/^"(.*)"$/, '$1');
      index += 1;
    } else {
      args[keyPart] = true;
    }
  }
  return args;
};

const toNumber = (value, fallback) => {
  if (value === undefined || value === null) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

/** Agung dev testnet defaults when `PEAQ_ENABLED` and RPC URLs omitted (docs/RAID_APP_PEAQ_CLAIM_SPEC.md). */
const PEAQ_AGUNG_HTTP_DEFAULT = 'https://peaq-agung.api.onfinality.io/public';
const PEAQ_AGUNG_WSS_DEFAULT = 'wss://wss-async.agung.peaq.network';

/** @param {string|undefined|null} value @param {boolean} defaultValue */
const parseEnvBool = (value, defaultValue) => {
  if (value === undefined || value === null || String(value).trim() === '') {
    return defaultValue;
  }
  const s = String(value).trim().toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(s)) {
    return false;
  }
  if (['1', 'true', 'yes', 'on'].includes(s)) {
    return true;
  }
  return defaultValue;
};

const loadConfig = (argv = []) => {
  loadEnvFile();
  const args = parseArgs(argv);

  const privateKey = args['x402-private-key'] || process.env.X402_PRIVATE_KEY || null;
  const walletId = args['x402-wallet-id'] || process.env.X402_WALLET_ID || null;

  if (!privateKey) {
    logger.warn('x402 private key is not configured. Outgoing payments will fail until configured.');
  }

  const trustProxyRaw = process.env.TRUST_PROXY;
  let trustProxy = false;
  if (trustProxyRaw !== undefined && trustProxyRaw !== '' && trustProxyRaw !== 'false' && trustProxyRaw !== '0') {
    trustProxy = trustProxyRaw === 'true' ? 1 : toNumber(trustProxyRaw, 1);
  }

  const cookieSecureRaw = (process.env.TELEOPERATOR_COOKIE_SECURE || 'auto').toLowerCase();
  let teleoperatorCookieSecureMode = 'auto';
  if (cookieSecureRaw === 'true' || cookieSecureRaw === '1' || cookieSecureRaw === 'always') {
    teleoperatorCookieSecureMode = 'always';
  } else if (cookieSecureRaw === 'false' || cookieSecureRaw === '0' || cookieSecureRaw === 'never') {
    teleoperatorCookieSecureMode = 'never';
  }

  const adminCookieSecureRaw = (
    process.env.ADMIN_COOKIE_SECURE || process.env.TELEOPERATOR_COOKIE_SECURE || 'auto'
  ).toLowerCase();
  let adminCookieSecureMode = 'auto';
  if (adminCookieSecureRaw === 'true' || adminCookieSecureRaw === '1' || adminCookieSecureRaw === 'always') {
    adminCookieSecureMode = 'always';
  } else if (
    adminCookieSecureRaw === 'false'
    || adminCookieSecureRaw === '0'
    || adminCookieSecureRaw === 'never'
  ) {
    adminCookieSecureMode = 'never';
  }

  const adminSessionSecret =
    process.env.ADMIN_SESSION_SECRET
    || process.env.TELEOPERATOR_JWT_SECRET
    || (process.env.NODE_ENV === 'production' ? null : 'dev-admin-session-secret');

  return {
    server: {
      host: process.env.HOST || args.host || '0.0.0.0',
      port: toNumber(args.port || process.env.PORT, 3000),
      trustProxy,
    },
    x402: {
      privateKey,
      walletId,
      gatewayUrl: args['x402-gateway-url'] || process.env.X402_GATEWAY_URL || 'https://api.corbits.dev',
      paymentEndpoint: args['x402-payment-endpoint'] || process.env.X402_PAYMENT_ENDPOINT || '/v1/payments',
      paymentTimeoutMs: toNumber(
        args['x402-payment-timeout'] || process.env.X402_PAYMENT_TIMEOUT_MS,
        10000,
      ),
      paymentProvider: (args['x402-payment-provider'] || process.env.X402_PAYMENT_PROVIDER || 'gateway').toLowerCase(),
      confirmation: {
        maxAttempts: toNumber(
          args['x402-confirm-attempts'] || process.env.X402_CONFIRM_ATTEMPTS,
          5,
        ),
        delayMs: toNumber(
          args['x402-confirm-delay'] || process.env.X402_CONFIRM_DELAY_MS,
          2000,
        ),
      },
      solana: (() => {
        const solana = {
          rpcProvider: (args['solana-rpc-provider'] || process.env.SOLANA_RPC_PROVIDER || 'helius').toLowerCase(),
          heliusApiKey: args['helius-api-key'] || process.env.HELIUS_API_KEY || null,
          rpcUrl: args['x402-solana-rpc-url'] || process.env.X402_SOLANA_RPC_URL || null,
          commitment: args['x402-solana-commitment'] || process.env.X402_SOLANA_COMMITMENT || 'confirmed',
        minConfirmations: toNumber(
          args['x402-solana-min-confirmations'] || process.env.X402_SOLANA_MIN_CONFIRMATIONS,
          1,
        ),
        secretKey: args['x402-solana-secret-key'] || process.env.X402_SOLANA_SECRET_KEY || privateKey,
      };
        solana.rpcUrl = buildSolanaRpcUrl(solana);
        return solana;
      })(),
    },
    commands: {
      dance: {
        selectionStrategy: (args['command-dance-strategy']
          || process.env.COMMAND_DANCE_STRATEGY
          || 'lowest_price').toLowerCase(),
      },
      buyCola: {
        selectionStrategy: (args['command-buy-cola-strategy']
          || process.env.COMMAND_BUY_COLA_STRATEGY
          || 'closest').toLowerCase(),
      },
    },
    pricing: {
      markupPercent: toNumber(
        args['pricing-markup-percent'] || process.env.PRICING_MARKUP_PERCENT,
        10,
      ),
    },
    robots: {
      healthTimeoutMs: toNumber(args['robot-health-timeout'] || process.env.ROBOT_HEALTH_TIMEOUT_MS, 5000),
      commandTimeoutMs: toNumber(args['robot-command-timeout'] || process.env.ROBOT_COMMAND_TIMEOUT_MS, 8000),
      defaultHealthEndpoint: args['robot-health-endpoint'] || process.env.ROBOT_HEALTH_ENDPOINT || '/health',
      defaultSecureHealthEndpoint: args['robot-secure-health-endpoint'] || process.env.ROBOT_SECURE_HEALTH_ENDPOINT || '/helth',
      /** Shared secret robots use to enroll / fleet-authenticated writes (trimmed; empty = disabled for enroll) */
      fleetEnrollmentSecret: (() => {
        const v = process.env.ROBOT_FLEET_ENROLLMENT_SECRET;
        if (v === undefined || v === null) return null;
        const t = String(v).trim();
        return t || null;
      })(),
      /** Optional: Task Router authenticates to robot operator-registry HTTP API (see docs/ROBOT_OPERATOR_SYNC.md) */
      raidToRobotSecret: (() => {
        const v = process.env.RAID_TO_ROBOT_SECRET;
        if (v === undefined || v === null) return null;
        const t = String(v).trim();
        return t || null;
      })(),
    },
    mdns: {
      enabled: parseEnvBool(process.env.MDNS_ENABLED, false),
      /** mDNS instance name → other hosts resolve as `<name>.local` (bonjour-service) */
      /** Default `raid-app` keeps LAN mDNS hostname stable for existing robot configs (`http://raid-app.local:PORT`). */
      hostname: (process.env.MDNS_HOSTNAME || 'raid-app').trim() || 'raid-app',
    },
    database: {
      url: process.env.DATABASE_URL || null,
    },
    teleoperator: {
      jwtSecret:
        process.env.TELEOPERATOR_JWT_SECRET
        || (process.env.NODE_ENV === 'production' ? null : 'dev-teleoperator-jwt-secret-change-me'),
      jwtExpiresIn: process.env.TELEOPERATOR_JWT_EXPIRES_IN || '7d',
      cookieName: 'teleop_token',
      bcryptRounds: toNumber(process.env.TELEOPERATOR_BCRYPT_ROUNDS, 10),
      /** 'auto' | 'always' | 'never' — Secure flag on cookie (plain HTTP broke login with always+production) */
      cookieSecureMode: teleoperatorCookieSecureMode,
    },
    teleop: {
      enabled: process.env.TELEOP_WS_ENABLED !== '0' && process.env.TELEOP_WS_ENABLED !== 'false',
      maxMessageBytes: toNumber(process.env.TELEOP_MAX_MESSAGE_BYTES, 16 * 1024 * 1024),
      rosbridgeConnectTimeoutMs: toNumber(process.env.TELEOP_ROSBRIDGE_CONNECT_TIMEOUT_MS, 10000),
      /** Attempts to open outbound WS to rosbridge (each attempt uses rosbridgeConnectTimeoutMs). */
      rosbridgeConnectAttempts: toNumber(process.env.TELEOP_ROSBRIDGE_CONNECT_ATTEMPTS, 3),
      /** Delay between attempts (ms). */
      rosbridgeReconnectDelayMs: toNumber(process.env.TELEOP_ROSBRIDGE_RECONNECT_DELAY_MS, 2000),
      /**
       * After a rosbridge connection drops — how many times the server repeats the connect cycle
       * (rosbridgeConnectAttempts attempts with delay) while the client WS to Task Router stays open.
       */
      rosbridgeDropReconnectAttempts: toNumber(process.env.TELEOP_ROSBRIDGE_DROP_RECONNECT_ATTEMPTS, 3),
      /**
       * After operator disconnect from /ws/teleop/session/... or final rosbridge failure:
       * wait this many ms before closing the DB session row (same sessionId + JWT may reconnect until then).
       * 0 — close the DB session immediately (legacy behavior).
       */
      sessionEndGraceMs: toNumber(process.env.TELEOP_SESSION_END_GRACE_MS, 120000),
      /** Outbound WS to rosbridge: forward teleoperator id/login (headers and/or query). */
      forwardOperatorHeaders: parseEnvBool(process.env.TELEOP_FORWARD_OPERATOR_HEADERS, true),
      forwardOperatorQuery: parseEnvBool(process.env.TELEOP_FORWARD_OPERATOR_QUERY, true),
      /** HTTP reverse proxy to robot dataset API (operator JWT); upstream connect + body (ms). */
      datasetProxyTimeoutMs: toNumber(
        process.env.TELEOP_DATASET_PROXY_TIMEOUT_MS,
        300000,
      ),
      /** Ed25519 signing key for KYR SessionGrant (Solana secret format; pubkey exposed in /health as teleopGrantSignerPublicKey). */
      grantSigningSecretKey: (() => {
        const v = process.env.TELEOP_GRANT_SIGNING_SECRET_KEY;
        if (v === undefined || v === null) return null;
        const t = String(v).trim();
        return t || null;
      })(),
      grantTtlSec: toNumber(process.env.TELEOP_GRANT_TTL_SEC, 86400),
      /** Hint in SessionGrant scope_json for flat SOL payment to operator (rospy_x402 / ROS_X402_PAY). */
      operatorFlatPaymentSol: (() => {
        const raw = process.env.TELEOP_OPERATOR_FLAT_SOL;
        const n = raw === undefined || raw === null || String(raw).trim() === ''
          ? 0.0005
          : Number(String(raw).trim());
        return Number.isFinite(n) && n >= 0 ? n : 0.0005;
      })(),
      /** Client /invoice and /estimate: command `any_teleop` → this HTTP path on the robot (ROS_X402_PAY). */
      anyTeleopHttpPath: (() => {
        const p = (process.env.ANY_TELEOP_HTTP_PATH || '/x402/any_teleop').trim();
        return p.startsWith('/') ? p : `/${p}`;
      })(),
      anyTeleopFixedSol: (() => {
        const raw = process.env.ANY_TELEOP_FIXED_SOL;
        const n = raw === undefined || raw === null || String(raw).trim() === ''
          ? 0.0005
          : Number(String(raw).trim());
        return Number.isFinite(n) && n >= 0 ? n : 0.0005;
      })(),
    },
    peaq: (() => {
      const peaqEnabled = parseEnvBool(process.env.PEAQ_ENABLED, false);
      const trimEnv = (key) => {
        const v = process.env[key];
        if (v === undefined || v === null) return null;
        const t = String(v).trim();
        return t || null;
      };
      let httpBaseUrl = trimEnv('PEAQ_HTTP_BASE_URL');
      let wssBaseUrl = trimEnv('PEAQ_WSS_BASE_URL');
      if (peaqEnabled) {
        if (!httpBaseUrl) {
          httpBaseUrl = PEAQ_AGUNG_HTTP_DEFAULT;
        }
        if (!wssBaseUrl) {
          wssBaseUrl = PEAQ_AGUNG_WSS_DEFAULT;
        }
      }
      return {
        enabled: peaqEnabled,
        httpBaseUrl,
        wssBaseUrl,
        machineDidName: trimEnv('PEAQ_MACHINE_DID_NAME'),
        machineEvmAddress: trimEnv('PEAQ_MACHINE_EVM_ADDRESS'),
        networkLabel: (() => {
          const v = process.env.PEAQ_NETWORK;
          const t = v != null ? String(v).trim() : '';
          return t || 'peaq-agung';
        })(),
        claimSyncTimeoutMs: toNumber(process.env.PEAQ_CLAIM_SYNC_TIMEOUT_MS, 2500),
      };
    })(),
    admin: {
      username: (() => {
        const v = process.env.ADMIN_USERNAME;
        if (v === undefined || v === null) return 'admin';
        const t = String(v).trim();
        return t || 'admin';
      })(),
      password: (() => {
        const v = process.env.ADMIN_PASSWORD;
        if (v === undefined || v === null) return 'admin';
        const t = String(v).trim();
        return t || 'admin';
      })(),
      sessionSecret: adminSessionSecret,
      jwtExpiresIn: process.env.ADMIN_SESSION_EXPIRES_IN || '8h',
      cookieName: 'admin_session',
      cookieSecureMode: adminCookieSecureMode,
    },
  };
};

const HELIUS_MAINNET_URL = 'https://mainnet.helius-rpc.com/?api-key=';
// PublicNode — free, no 403; mainnet-beta.solana.com often blocks requests
const PUBLIC_RPC_URL = 'https://solana-rpc.publicnode.com';

/**
 * Returns resolved Solana RPC URL from settings (provider + key or custom URL).
 * mainnet-beta.solana.com often returns 403, so we do not use it as fallback.
 * @param {{ rpcProvider?: string, heliusApiKey?: string, rpcUrl?: string }} solana
 */
const buildSolanaRpcUrl = (solana = {}) => {
  const provider = (solana.rpcProvider || 'public').toLowerCase();
  if (provider === 'custom' && solana.rpcUrl) {
    return solana.rpcUrl;
  }
  if (provider === 'helius' && solana.heliusApiKey) {
    return `${HELIUS_MAINNET_URL}${solana.heliusApiKey}`;
  }
  const fallback = solana.rpcUrl;
  if (fallback && !fallback.includes('mainnet-beta.solana.com')) {
    return fallback;
  }
  return PUBLIC_RPC_URL;
};

module.exports = {
  loadConfig,
  parseArgs,
  buildSolanaRpcUrl,
  HELIUS_MAINNET_URL,
  PUBLIC_RPC_URL,
  PEAQ_AGUNG_HTTP_DEFAULT,
  PEAQ_AGUNG_WSS_DEFAULT,
};

