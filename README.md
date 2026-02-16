# x402 Task Router Service

Node.js service orchestrating x402-enabled payments and robot control flows. It exposes REST endpoints to register and monitor robots, trigger collaborative commands (for example, `dance` and `buy-cola`), and serves a lightweight web console for day-to-day operations.

## Features

- x402-ready request signing for outgoing robot commands and verification middleware for incoming payment callbacks.
- Pluggable x402 payment providers (external facilitator or direct Solana settlement).
- Health monitoring pipeline that polls robot `/health` (and `/helth` for legacy setups) endpoints with optional x402 fallback.
- In-memory robot registry with status, available method discovery, and location tracking.
- Command router that distributes work across available robots, including proximity-based selection for logistics scenarios.
- Static web UI (`/ui`) for robot registration, status review, and quick command dispatch.

## Getting Started

### Prerequisites

- Node.js 18 or later.
- npm 9 or later.
- A valid x402 private key (if you plan to access secured robot endpoints or verify payments).

### Installation

```bash
npm install
```

### Configuration

Environment variables can be provided via a `.env` file (copy `config/env.example`) or directly in the shell. Command-line flags override environment variables when present.

| Environment variable | CLI flag | Description | Default |
| --- | --- | --- | --- |
| `HOST` | `--host` | Network interface for the HTTP server | `0.0.0.0` |
| `PORT` | `--port` | HTTP port for the control service | `3000` |
| `X402_PRIVATE_KEY` | `--x402-private-key` | Private key used to sign x402 requests | _required for secure robots_ |
| `X402_WALLET_ID` | `--x402-wallet-id` | Optional wallet identifier header for x402 integrations | _none_ |
| `X402_GATEWAY_URL` | `--x402-gateway-url` | Base URL for upstream x402 gateways | `https://api.corbits.dev` |
| `X402_PAYMENT_ENDPOINT` | `--x402-payment-endpoint` | Relative path for payment settlements | `/v1/payments` |
| `X402_PAYMENT_TIMEOUT_MS` | `--x402-payment-timeout` | Payment settlement timeout (ms) | `10000` |
| `X402_PAYMENT_PROVIDER` | `--x402-payment-provider` | `gateway` (default) or `solana-direct` | `gateway` |
| `X402_CONFIRM_ATTEMPTS` | `--x402-confirm-attempts` | Retries when waiting for robot to observe payment | `5` |
| `X402_CONFIRM_DELAY_MS` | `--x402-confirm-delay` | Delay between payment confirmation attempts (ms) | `2000` |
| `X402_SOLANA_RPC_URL` | `--x402-solana-rpc-url` | RPC endpoint for direct Solana settlements | _none_ |
| `X402_SOLANA_COMMITMENT` | `--x402-solana-commitment` | Solana commitment level (`processed` \| `confirmed` \| `finalized`) | `confirmed` |
| `X402_SOLANA_MIN_CONFIRMATIONS` | `--x402-solana-min-confirmations` | Additional confirmations to await after send | `1` |
| `X402_SOLANA_SECRET_KEY` | `--x402-solana-secret-key` | Base64/base58/JSON secret key for SOL transfers (defaults to `X402_PRIVATE_KEY`) | _none_ |
| `COMMAND_DANCE_STRATEGY` | `--command-dance-strategy` | Executor selection strategy for `dance` (`lowest_price`, `sequential`, `random`) | `lowest_price` |
| `COMMAND_BUY_COLA_STRATEGY` | `--command-buy-cola-strategy` | Executor selection strategy for `buy-cola` (`closest`, `lowest_price`) | `closest` |
| `PRICING_MARKUP_PERCENT` | `--pricing-markup-percent` | Markup percentage added on top of robot costs for suggested pricing | `10` |
| `ROBOT_HEALTH_TIMEOUT_MS` | `--robot-health-timeout` | Health-check timeout per robot (ms) | `5000` |
| `ROBOT_COMMAND_TIMEOUT_MS` | `--robot-command-timeout` | Command dispatch timeout (ms) | `8000` |
| `ROBOT_HEALTH_ENDPOINT` | `--robot-health-endpoint` | Public health endpoint path | `/health` |
| `ROBOT_SECURE_HEALTH_ENDPOINT` | `--robot-secure-health-endpoint` | Secured health endpoint path (x402) | `/helth` |
| `ADMIN_USERNAME` | — | Admin panel HTTP Basic auth username | `admin` |
| `ADMIN_PASSWORD` | — | Admin panel HTTP Basic auth password | _required for /ui_ |
| `AI_AGENT_STRATEGY` | — | Task Router mode executor selection (`smart`, `lowest_price`, `closest`, `fastest`) | `smart` |
| `N8N_WEBHOOK_URL` | — | Optional N8N webhook for custom AI-based robot selection | _none_ |

### Scripts

```bash
npm run start      # run the production server
npm run dev        # run in watch mode with nodemon
```

### API Overview

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | Service heartbeat and high-level state. |
| `GET` | `/api/robots` | List registered robots and their status. |
| `POST` | `/api/robots` | Register a new robot `{ host, port, name?, requiresX402? }`. |
| `PUT` | `/api/robots/{id}` | Update robot metadata. |
| `POST` | `/api/robots/{id}/refresh` | Trigger an immediate health check. |
| `DELETE` | `/api/robots/{id}` | Remove a robot from the registry. |
| `POST` | `/api/commands/dance` | Dispatch the move demo command `{ quantity: 1 | 2 | "all" }` with x402 handshake. |
| `POST` | `/api/commands/buy-cola` | Dispatch a logistics task `{ location, quantity }`. |
| `POST` | `/api/payments/x402` | Example endpoint protected by x402 middleware. Post payment callbacks here. |

> `POST /api/commands/dance` uses the **x402 V2** flow: request paid endpoint → receive **HTTP 402** with `x402Version: 2` and `accepts[]` (reference in `accepts[0].extra.reference`, `payTo`, `amount`, `asset`) → settle payment (gateway or direct Solana) → retry with **`X-X402-Reference`** header. Command responses include a `summary` with executor strategy, robot costs, and suggested client price (see [docs/X402_PROTOCOL.md](docs/X402_PROTOCOL.md)).

### Payment Providers

By default, the service delegates settlements to an external x402 gateway (facilitator). To run without a facilitator, switch to the built-in Solana sender:

```bash
X402_PAYMENT_PROVIDER=solana-direct \
X402_SOLANA_RPC_URL=https://api.mainnet-beta.solana.com \
X402_SOLANA_SECRET_KEY=<base64-or-json-secret> \
npm run start
```

The direct provider creates on-chain SOL transfers via `@solana/web3.js`, waiting for the configured confirmations before completing the robot command. This mirrors the optional architecture described in the x402 examples, where validation can rely solely on blockchain state instead of a facilitator service.[^1]

### Executor Selection & Pricing

- `COMMAND_DANCE_STRATEGY` controls how robots are chosen for the `dance` command. The default `lowest_price` ranks robots by the price advertised in their health metadata (`availableMethods[].pricing`). Fallback strategies include `sequential` (keep registration order) and `random`.
- `COMMAND_BUY_COLA_STRATEGY` defaults to `closest`, selecting the robot geographically nearest to the requested location. Set it to `lowest_price` to prefer cheaper vendors when pricing is available.
- `PRICING_MARKUP_PERCENT` applies a markup on top of the sum of robot costs when reporting suggested prices in command responses. The default adds 10 %, so a 0.1 SOL dance results in a suggested client charge of 0.11 SOL.

### Web Console

- **Root** `http://localhost:3000/` redirects to the **public client UI** at `/client` (wallet payments, Direct/Task Router modes).
- **Admin panel** `http://localhost:3000/ui` (auth required) supports:
  - Registering robots and marking them as x402-secured.
  - Viewing status, rich method cards (with pricing and parameters), and location per robot.
  - Triggering `dance` and `buy-cola` commands.
  - Map view with markers for every robot reporting coordinates.
  - Manual refresh (per robot or bulk) and removal controls.
  - RPC settings (Helius, custom URL) for the client page.

See [CLIENT_UI.md](CLIENT_UI.md) for the public client API and modes.

### API Reference

- OpenAPI/Swagger UI is available at `http://localhost:3000/docs`.
- `swagger.json` can be retrieved from `http://localhost:3000/docs-json` for automation or SDK generation.

### Robot Expectations

Robots should expose at least:

- `GET /health` (or `/helth`) → `{ status, message?, availableMethods?, location? }`.
- `POST /commands/dance` → payload `{ mode }`.
- `POST /commands/buy-cola` → payload `{ location, quantity }`.

`availableMethods` can be an array of plain strings or objects with structure:

```json
{
  "path": "/commands/dance",
  "httpMethod": "POST",
  "description": "Trigger a sample motion.",
  "parameters": {
    "kwargs": { "demo_name": "wave" }
  },
  "pricing": {
    "amount": 0.001,
    "assetSymbol": "SOL",
    "receiverAccount": "So11111111111111111111111111111111111111112",
    "paymentWindowSec": 180
  }
}
```

If a robot is configured as `requiresX402`, paid endpoints are called without payment first; on **402** we parse the V2 body (`accepts[0]`), settle the invoice, then retry with **`X-X402-Reference`**. For optional legacy or custom auth, `x-402-signature` / `x-402-wallet` can be added in `src/services/x402Service.js`. Protocol details: [docs/X402_PROTOCOL.md](docs/X402_PROTOCOL.md) and [x402 Register Resource](https://www.x402scan.com/resources/register).

### Extending the Service

- **Persistence:** swap the in-memory registry with a database-backed implementation.
- **Automation:** schedule periodic health checks with a job runner (BullMQ, Agenda, etc.).
- **Commands:** add new command handlers via `src/services/commandRouter.js` and expose routes inside `src/routes/commands.js`.
- **Executor strategies:** tweak `COMMAND_DANCE_STRATEGY` / `COMMAND_BUY_COLA_STRATEGY` to favour the cheapest or closest robots without touching code.
- **Pricing:** adjust `PRICING_MARKUP_PERCENT` to control the margin added on top of the robots’ advertised costs when returning suggested client prices.
- **Security:** protect the REST API with authentication middleware or API keys before production use.

### Development Notes

- All logs emit JSON-friendly structured strings.
- Errors bubble through the Express error handler for consistent responses.
- Comments and logging are in English for broader team collaboration, per requirements.

[^1]: [X402 Next.js template from Solana](https://templates.solana.com/x402-template)

