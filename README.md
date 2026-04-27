# Task-router-x402

Node.js (Express) **x402 Task Router**: orchestrates x402 payments and robot calls. It includes a **public client UI** (`/client`), an **admin panel** (`/ui`, Basic Auth), REST APIs for the robot registry, high-level commands, and the **client flow** (estimate, 402 invoice, in-browser payment, execution with **X-X402-Reference**).

## Features

- **x402 V2** on robot calls: first request → **402** with `accepts[]` → payment (gateway or direct Solana) → retry with **X-X402-Reference** (see [docs/X402_PROTOCOL.md](docs/X402_PROTOCOL.md)).
- Payment providers: external x402 gateway or **solana-direct** (`@solana/web3.js`).
- Robot health monitoring: polls `/health` and legacy `/helth` (x402 when required).
- Robot registry: with **`DATABASE_URL`**, rows are stored in PostgreSQL (table **`robots`**) and survive restarts; **health status** stays in process memory and is updated by polling the robot. Without **`DATABASE_URL`**, the registry is RAM-only (as before).
- **Command router**: `dance`, `buy-cola` with executor selection (price, order, random / closest to a point).
- **Task Router mode for the client** (API `mode`: `raid`): robot selection via **AIAgentService** (strategies or **n8n** webhook), configured in the admin UI.
- **ClientPaymentService**: Solana transaction verification and hooks for refund on execution failure.
- **OpenAPI**: Swagger UI `/docs`, JSON `/docs-json` (see `src/docs/swagger.js` and JSDoc `@openapi` in routers).
- **Teleoperator** (when `DATABASE_URL` is set): registration and login (login + password); PostgreSQL stores a **bcrypt** password hash and the **public** Solana `walletPublicKey`; session is a **JWT** in httpOnly cookie `teleop_token` and **`accessToken`** in JSON (for WebSocket and native clients). Dashboard `/teleoperator/cabinet`: open “help” requests, accept, **WebSocket URL** for ROSBridge proxy (see below).
- **Teleop proxy (ROSBridge)**: robot and **Task Router** on the **same LAN**; the server opens an outbound WebSocket to `ws://rosbridgeHost:rosbridgePort` (default same `host`, port **9090**). By default the **teleoperator identity** is attached: headers **`X-Teleoperator-Id`** / **`X-Teleoperator-Login`** and query **`teleoperator_id`** / **`teleoperator_login`** (disable with **`TELEOP_FORWARD_OPERATOR_HEADERS`** / **`TELEOP_FORWARD_OPERATOR_QUERY`**). Operators and VR clients connect only to **this service** (`/ws/teleop/session/...`), not directly to rosbridge from the internet. Request **`POST /api/robots/{id}/teleop/help`** with **`X-Robot-Teleop-Secret`**; **`help_request`** on **`/ws/teleoperator?token=JWT`** and rows from **`GET /api/teleoperator/help-requests`** reach **all** connected operators only if the robot has **no** active rows in **`teleoperator_robot_grants`**. If grants exist, notifications and the request list for that robot are visible **only** to operators with a grant (table **`teleoperator_robot_grants`**, UI **`/ui/teleop-access.html`**); the same set may accept. Request context in **`payload`** (including **`metadata.situation_report`**, optional **`metadata.kyr_peaq_context`** for Peaq). Optional **Peaq claim**: with **`PEAQ_ENABLED`** and configured RPC/DID see [docs/RAID_APP_PEAQ_CLAIM_SPEC.md](docs/RAID_APP_PEAQ_CLAIM_SPEC.md); the help response includes **`id`** and on success **`peaq_claim`**, otherwise poll **`GET /api/robots/{id}/peaq/claim?helpRequestId=`**. See also [docs/VR_TELEOP_HELP_CLIENT.md](docs/VR_TELEOP_HELP_CLIENT.md).
- **Dataset HTTP proxy (operator → robot)**: with **`DATABASE_URL`**, prefix **`/api/teleop/robots/{robotId}/dataset/...`** — same teleoperator JWT and **same grant rules** as accepting a help request. Requests are **streamed** to the robot’s dataset HTTP server (default **`host:9191`**, or registry fields **`datasetHttpHost`** / **`datasetHttpPort`**). Details: [docs/RAID_APP_DATASET_PROXY_SPEC.md](docs/RAID_APP_DATASET_PROXY_SPEC.md).
- **Fleet and mDNS**: **`ROBOT_FLEET_ENROLLMENT_SECRET`** for **`POST /api/robots/enroll`** (stable **`enrollmentKey`** on the robot); optional **`MDNS_ENABLED`** / **`MDNS_HOSTNAME`** — service advertised on LAN as **`<hostname>.local`** (see `config/env.example`). Push allowlist to robot: **`RAID_TO_ROBOT_SECRET`** and [docs/ROBOT_OPERATOR_SYNC.md](docs/ROBOT_OPERATOR_SYNC.md).

## Quick start

### Requirements

- Node.js 18+
- npm 9+
- For protected robots and server-side payments: `X402_PRIVATE_KEY` (and Solana key if needed).
- For teleoperator, **persistent robot registry**, **teleop proxy**, and **dataset HTTP proxy** (`/api/teleop/...`): **PostgreSQL** and `DATABASE_URL`, `TELEOPERATOR_JWT_SECRET` (see below). Without `DATABASE_URL`, routes `/api/teleoperator/*`, **`/api/.../teleop/help`**, **`/api/teleop/*`**, UI `/teleoperator`, and teleop WebSockets are **not mounted**, and robots are **not persisted** across app restarts.

### Install and run

**Option A — full stack in the background (Docker, recommended on a server)**  
**PostgreSQL** and the **Node app** run with **`restart: unless-stopped`** (containers restart after host reboot; process crash triggers restart).

```bash
cp config/env.example .env   # fill keys, TELEOPERATOR_JWT_SECRET, ADMIN_*, etc.
docker compose up -d --build
```

- API and UI are reachable **from any machine on the network** (if the firewall allows): `http://<server-IP-or-DNS>:3000`. Host port: `APP_HOST_PORT` (default 3000), bind **`0.0.0.0`** (all interfaces).
- Inside compose, **`DATABASE_URL` for the app container is set automatically** (host `postgres`, port `5432`); the `DATABASE_URL` value in `.env` is **overridden** by the `app` service for this mode.
- The **`config/`** directory is mounted into the container: `client-settings.json`, `ai-agent.json`, etc. persist on the host.
- **PostgreSQL** data lives in the named volume **`x402_raid_pgdata`** (robots, teleoperators, help requests survive image rebuilds). **Do not** use `docker compose down -v` if you need to keep users and robots — **`-v` deletes the volume and all data**. Normal stop: `docker compose down` **without** `-v`.
- **`docker compose up -d --build` and host reboot alone do not clear tables** — on startup the app only creates/extends schema (`IF NOT EXISTS`), no `TRUNCATE`/`DROP` on production data.
- If robots and operators “suddenly” disappear, common causes: (1) **`docker compose down -v`** or **`docker volume prune`** was run; (2) **`npm test`** on the same host with **`TEST_DATABASE_URL`** pointing at the **same Postgres** exposed on **`localhost:5434`** — tests run **`TRUNCATE … CASCADE`** on teleop and robot tables; (3) the repo folder was **renamed or cloned elsewhere** — Docker Compose project name changes → **new empty volume** (see `docker volume ls | grep x402`). On a server, **do not** keep `TEST_DATABASE_URL` in `.env` or export it in your shell if compose Postgres runs on the same host.

- Logs: `docker compose logs -f app`
- Stop: `docker compose down`

The image is built from [`Dockerfile`](Dockerfile) at the repo root.

**Option B — Postgres in Docker only, app locally (`npm run start`)**

```bash
npm install
cp config/env.example .env
docker compose up -d postgres   # database only
# in .env: DATABASE_URL=postgres://x402:x402@localhost:5434/x402raid
npm run start                # production
npm run dev                  # nodemon
```

The server listens on **`HOST`** / **`PORT`**. Default **`HOST=0.0.0.0`** is **not** “localhost only”: the process accepts connections on **all** interfaces; from another machine use **`http://<public-IP-or-DNS>:3000`** (port from `PORT` / `APP_HOST_PORT` in Docker). Examples with `localhost` in docs are for checks **from the server itself**. If you set **`HOST=127.0.0.1`**, the network cannot reach it (a warning is logged).

**PostgreSQL (compose):** port **5434** is bound to **`127.0.0.1`** on the host (local access only, not from the internet). User `x402`, password `x402`, database `x402raid`. For `npm run` on the host: `DATABASE_URL=...localhost:5434...`. The `app` container uses internal address `postgres:5432`. On startup, tables **`teleoperators`**, **`robots`**, **`help_requests`** (including **`peaq_claim`** JSONB for teleop Peaq), **`teleop_sessions`**, **`teleoperator_robot_grants`** (teleoperator↔robot ACL) are created.

**Option C — systemd without Docker (sample unit)**  
Template: [`deploy/task-router-x402.service.example`](deploy/task-router-x402.service.example) — copy to `/etc/systemd/system/`, adjust paths and `User=`, then `sudo systemctl enable --now task-router-x402`.

## Interfaces

| Path | Purpose |
| ---- | ------- |
| `/` | Redirect to `/client` |
| `/client` | Public UI: RPC settings, robot/command list, direct/raid, payment and execution |
| `/ui` | Admin: session via **`POST /api/admin/login`** (cookie) or redirect to `/ui/login.html`; `/api/admin/*` — cookie **or** HTTP Basic (`ADMIN_USERNAME` / `ADMIN_PASSWORD`) |
| `/ui/teleop-access.html` | Operators and robots, **grants** (who may accept teleop on which robot), allowlist sync to robot ([docs/ROBOT_OPERATOR_SYNC.md](docs/ROBOT_OPERATOR_SYNC.md)). “Add grant” lists operators from DB: at least one registration on **`/teleoperator`** is required first. |
| `/docs` | Swagger UI |
| `/docs-json` | OpenAPI spec (JSON) |
| `/teleoperator` | Teleoperator UI: register, login (only if `DATABASE_URL` is set) |
| `/teleoperator/cabinet` | Dashboard (session required; otherwise redirect to login). HTML is served by the server, not public static only |
| `ws://…/ws/teleoperator?token=` | Events for teleoperators (new help request). With per-robot ACL, only operators with a grant. Same JWT as `accessToken` / cookie. Behind HTTPS use **`wss://`** (reverse proxy). |
| `ws://…/ws/teleop/session/{sessionId}?token=` | Duplex proxy **as direct ROSBridge** (same JSON messages `op` / `topic` / `msg`). `sessionId` is returned after **`POST …/help-requests/{id}/accept`**. |

## Configuration

Environment variables and CLI flags are described in `config/env.example`. Flags like `--port 3000` override env.

**Solana RPC:** provider via `SOLANA_RPC_PROVIDER` (`helius` | `public` | `custom`) and optionally `HELIUS_API_KEY` or `X402_SOLANA_RPC_URL`. Public fallback in code is not `mainnet-beta.solana.com` (frequent 403); see `buildSolanaRpcUrl` in `src/config.js`.

**Persistent client settings** (RPC from UI) are written to `config/client-settings.json` via `settingsStore`.

**AI agent settings** (strategy, n8n URL) can be saved from the admin UI to `config/ai-agent.json` (also see `AI_AGENT_STRATEGY`, `N8N_WEBHOOK_URL` in env).

### Admin access

| Variable | Description | Default |
| -------- | ----------- | ------- |
| `ADMIN_USERNAME` | Basic Auth user | `admin` |
| `ADMIN_PASSWORD` | Password (**change in production**) | `admin` |

Protected prefixes: static `/ui` (except login and shared styles) and `/api/admin/*` after login or Basic.

### CORS and app access

- **CORS** is enabled with **`credentials: true`** and dynamic **`Origin`** (echoes the request origin). Browser SPAs / another origin may call the API with `fetch(..., { credentials: 'include' })` or **`Authorization: Bearer`** with the JWT from **`accessToken`** in login/register responses.
- **Native** clients usually **ignore CORS**; plain HTTP and **`Authorization: Bearer`** suffice.
- After **`POST /api/teleoperator/login`** or **`register`**, JSON includes **`accessToken`** (same JWT as cookie `teleop_token`). Store the token and send `Authorization: Bearer <accessToken>` on **`GET /api/teleoperator/me`** and beyond.

### Teleoperator and database

| Variable | Description |
| -------- | ----------- |
| `DATABASE_URL` | PostgreSQL connection URI. Without it teleoperator is off and **robots are not persisted**. Table **`robots`** is created on startup (same as teleoperator schema). |
| `TELEOPERATOR_JWT_SECRET` | JWT signing secret (**required** if `DATABASE_URL` is set). In dev, a weak default may apply (see `src/config.js`); in `NODE_ENV=production` the process exits without a secret. |
| `TELEOPERATOR_JWT_EXPIRES_IN` | JWT lifetime (e.g. `7d`, `24h`). Default `7d`. |
| `TELEOPERATOR_BCRYPT_ROUNDS` | Bcrypt cost (default `10`). |
| `TELEOPERATOR_COOKIE_SECURE` | `auto` (default), `always`, `never` — **Secure** flag on cookie. With **auto**, HTTP gets `Secure: false`; HTTPS (or proxy with `X-Forwarded-Proto: https` and **`TRUST_PROXY`**) gets `true`. |
| `TRUST_PROXY` | Behind reverse proxy: `1` or hop count; needed for **auto** Secure and `req.secure`. |
| `TELEOP_WS_ENABLED` | `false` or `0` — disable teleop WebSocket handler (REST help remains with `DATABASE_URL`). Default on. |
| `TELEOP_MAX_MESSAGE_BYTES` | Max WS frame size in bytes (default 16 MiB). |
| `TELEOP_ROSBRIDGE_CONNECT_TIMEOUT_MS` | Timeout for **one** attempt to open outbound WS to rosbridge (ms). |
| `TELEOP_ROSBRIDGE_CONNECT_ATTEMPTS` | Attempts per wave with pause **`TELEOP_ROSBRIDGE_RECONNECT_DELAY_MS`** before failure (default **3**). |
| `TELEOP_ROSBRIDGE_RECONNECT_DELAY_MS` | Pause between attempts (ms), default **2000**. |
| `TELEOP_ROSBRIDGE_DROP_RECONNECT_ATTEMPTS` | After rosbridge was up then dropped: how many full reconnect waves while the client WS to Task Router is still open (default **3**). When exhausted — **1011** to client. |
| `TELEOP_SESSION_END_GRACE_MS` | After operator disconnect from `/ws/teleop/session/...` or final rosbridge failure: wait this many **ms** before closing the **`teleop_sessions`** row (default **120000**). While open, reconnect with the same `sessionId` and JWT. **`0`** — close immediately (legacy). |
| `TELEOP_FORWARD_OPERATOR_HEADERS` | `true` / `false` (default `true`; also `0`, `false`, `no`, `off`). Outbound WS **Task Router → rosbridge**: **`X-Teleoperator-Id`** and **`X-Teleoperator-Login`**. |
| `TELEOP_FORWARD_OPERATOR_QUERY` | `true` / `false` (default `true`). Append query **`teleoperator_id`** / **`teleoperator_login`**. Set `false` if rosbridge/proxy breaks on `?…`. |
| `TELEOP_DATASET_PROXY_TIMEOUT_MS` | Outbound HTTP timeout to robot dataset for **`/api/teleop/robots/.../dataset/...`** (ms, default **300000**). |
| **`PEAQ_ENABLED`** | `true` / `1` / `yes` / `on` — enable **Peaq claim** for teleop help. Default in `config/env.example` is on for dev; set explicitly in prod. |
| **`PEAQ_HTTP_BASE_URL`** | HTTPS RPC (Agung dev). If **`PEAQ_ENABLED=true`** and empty — **`https://peaq-agung.api.onfinality.io/public`**. |
| **`PEAQ_WSS_BASE_URL`** | WSS for **`sdk.did.read`**. If **`PEAQ_ENABLED=true`** and empty — **`wss://wss-async.agung.peaq.network`**. |
| **`PEAQ_MACHINE_DID_NAME`** | Machine DID name on chain. |
| **`PEAQ_MACHINE_EVM_ADDRESS`** | EVM address linked to the DID. |
| **`PEAQ_NETWORK`** | Network label in claim JSON (default **`peaq-agung`**). |
| **`PEAQ_CLAIM_SYNC_TIMEOUT_MS`** | If **`did.read`** finishes within this window, **`peaq_claim`** may return inline from **POST …/teleop/help**; otherwise background write and **GET …/peaq/claim** (default **2500** ms in code; `config/env.example` may suggest a higher value). |

**Peaq / Agung (external failures):** Peaq RPC, AGNG faucet, or SDK downtime **does not break** **POST …/teleop/help** — the request is still created. If **`did.read`** fails, a fallback **`peaq_claim`** is stored with **`raid_peaq_read_status: "failed"`** and **`raid_peaq_error`** so **GET …/peaq/claim** does not spin on endless **404**. The robot may treat that as “no valid DID document”. See [docs/RAID_APP_PEAQ_CLAIM_SPEC.md](docs/RAID_APP_PEAQ_CLAIM_SPEC.md) §5.1.

**Machine DID onboarding on Agung (manual, before enroll integration):** script [`scripts/peaqOnboardMachine.js`](scripts/peaqOnboardMachine.js). Needs a wallet with test PEAQ on Agung for gas.

```bash
npm run peaq:onboard -- --dry-run
PEAQ_ONBOARD_EVM_PRIVATE_KEY=0x... npm run peaq:onboard
```

Stdout prints **`PEAQ_MACHINE_DID_NAME`** and **`PEAQ_MACHINE_EVM_ADDRESS`** — add to Task Router `.env`. **`PEAQ_ONBOARD_EVM_PRIVATE_KEY`** is only for sending the tx; runtime Task Router does not need a key for **`did.read`**. Export **`onboardPeaqMachine`** can later be called from robot registration code.

**AGNG faucet on docs.peaq.xyz (“Failed to fetch” / CORS):** the widget **POST**s to `dev-peaq-faucet-service.cisys.xyz`. If the origin times out, Cloudflare may return **524**; the error page lacks `Access-Control-Allow-Origin`, so the browser shows **CORS** — a side effect, not “wrong address”. Same machine without CORS: [`scripts/peaqFaucetRequest.js`](scripts/peaqFaucetRequest.js) — default timeout **180 s**:

```bash
npm run peaq:faucet -- 0xYourEvmAddress
```

If you still see **524** or timeout, the issue is Peaq’s faucet backend; try [Peaq Discord](https://discord.gg/peaqnetwork). Optional: **`PEAQ_FAUCET_APIKEY`**, **`PEAQ_FAUCET_URL`**, **`PEAQ_FAUCET_TIMEOUT_MS`** (see `config/env.example`).

Header and query identifiers are the teleoperator user **UUID** from PostgreSQL (same as JWT **`sub`**); **the JWT is not sent to the robot**. URL/header assembly: `buildRosbridgeWebSocketTarget` in [`src/ws/teleopServer.js`](src/ws/teleopServer.js). For dataset HTTP proxy, **`X-Forwarded-For`**, **`X-Forwarded-Proto`**, **`X-Teleoperator-Id`** (and **`X-Teleoperator-Login`** when present) are set; see [`src/services/teleopDatasetProxy.js`](src/services/teleopDatasetProxy.js).

### Robots: fleet secret, mDNS, allowlist sync

| Variable | Description |
| -------- | ----------- |
| **`ROBOT_FLEET_ENROLLMENT_SECRET`** | Shared fleet secret: `Authorization: Bearer …` or **`X-Robot-Fleet-Secret`** on **`POST /api/robots/enroll`** and (with admin) mutating **`/api/robots/*`**. Without it enroll returns **503**. Wrong secret: **401** with **`Invalid or missing fleet credential`**. If enroll returns only **`{"error":"Unauthorized"}`** with DB enabled — upgrade the app (route ordering with teleoperator was fixed). |
| **`RAID_TO_ROBOT_SECRET`** | Secret for HTTP **POST** to the robot’s **`operatorRegistryUrl`** (operator id push); see [docs/ROBOT_OPERATOR_SYNC.md](docs/ROBOT_OPERATOR_SYNC.md). |
| **`MDNS_ENABLED`** | `true` / `1` / `yes` / `on` — enable mDNS (UDP 5353, multicast). |
| **`MDNS_HOSTNAME`** | Instance name (default **`raid-app`**, unchanged for **robot/LAN compatibility** — many stacks use `http://raid-app.local:<PORT>`). Override for a different `.local` name (e.g. `task-router-x402`). On success logs show **`mDNS advertisement started`**; on error, LAN advertisement failed. In Docker **bridge** mode, multicast may not reach other hosts even if start succeeds — use **host network** for `app` or access by IP. |

## API (short)

### Service and robots

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/health` | Service status, robot count, x402 flag, **`teleoperatorEnabled`**, **`teleopWs`**, **`teleopGrantSignerPublicKey`** (Solana base58 SessionGrant signer when **`TELEOP_GRANT_SIGNING_SECRET_KEY`** set, else `null`) |
| `GET` | `/api/robots` | Public robot list **without** `teleopSecret`. Persistence as above. |
| `POST` | `/api/robots/enroll` | Fleet self-registration: **`ROBOT_FLEET_ENROLLMENT_SECRET`** (`Authorization: Bearer` or **`X-Robot-Fleet-Secret`**), body with **`enrollmentKey`**, `host`, `port`, optional `teleopSecret`, `operatorRegistryUrl`, **`datasetHttpHost`**, **`datasetHttpPort`** (dataset proxy; default port **9191** if unset). Idempotent upsert; response includes `teleopSecret`. Expected errors: **503** (fleet secret not configured), **401** mentioning **fleet credential**. |
| `POST` | `/api/robots` | New registration (new UUID): fleet secret **or** admin session. Full response with `teleopSecret`. |
| `PUT` / `DELETE` | `/api/robots/{id}` | Update / delete — fleet secret **or** admin. |
| `POST` | `/api/robots/{id}/refresh` | Health check — fleet secret **or** admin. |
| `GET` / `POST` | `/api/admin/robots` | List / create with full fields (including `teleopSecret`); **admin** only. |
| `PUT` / `DELETE` | `/api/admin/robots/{id}` | Update / delete. |
| `POST` | `/api/admin/robots/{id}/refresh` | Force health check. |

### Commands (server as x402 client to robots)

| Method | Path | Description |
| ------ | ---- | ----------- |
| `POST` | `/api/commands/dance` | `quantity`: `1`, `2`, or `"all"`; x402 when needed |
| `POST` | `/api/commands/buy-cola` | `location`, `quantity` |

### Client API (no admin auth; for `/client` and external clients)

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` / `POST` | `/api/client/settings` | Read / save RPC settings (Helius key not returned) |
| `GET` | `/api/client/robots` | Robots ready for direct mode |
| `GET` | `/api/client/commands` | Aggregated commands from registry |
| `POST` | `/api/client/estimate` | Price estimate: `mode` `direct` \| `raid`, `command`, optional `robotId`. Command **`any_teleop`**: all ready robots candidates; robot path default **`/x402/any_teleop`** (**`ANY_TELEOP_HTTP_PATH`**); if **`availableMethods`** has no price — estimate **`ANY_TELEOP_FIXED_SOL`** (default **0.0005** SOL). |
| `POST` | `/api/client/invoice` | Proxies first POST to robot → **200** or **402**. For **`any_teleop`**, same path and robot selection as **`/estimate`**. |
| `POST` | `/api/client/execute` | After wallet payment: verify tx, call robot with `X-X402-Reference` |

### Payments and admin API

| Method | Path | Description |
| ------ | ---- | ----------- |
| `POST` | `/api/payments/x402` | Sample callback with signature check (x402 middleware) |
| `GET` / `POST` | `/api/admin/ai-agent` | Read / save AI config (session or Basic) |
| `GET` / `POST` | `/api/admin/client-settings` | View / save RPC (session or Basic) |
| `GET` | `/api/admin/teleoperators` | Teleoperator list (public fields), for grants UI |
| `GET` / `POST` / `DELETE` | `/api/admin/teleoperator-grants` … | Operator↔robot grants; **DELETE** `/api/admin/teleoperator-grants/{teleoperatorId}/{robotId}` — revoke |
| `POST` | `/api/admin/robots/{id}/sync-operator-allowlist` | HTTP push allowlist to robot `operatorRegistryUrl` ([docs/ROBOT_OPERATOR_SYNC.md](docs/ROBOT_OPERATOR_SYNC.md)) |

### Teleoperator (no Basic Auth; session via `teleop_token` cookie)

| Method | Path | Description |
| ------ | ---- | ----------- |
| `POST` | `/api/teleoperator/register` | Body: `login`, `password`, `walletPublicKey` (Solana). 201: cookie + **`accessToken`**. |
| `POST` | `/api/teleoperator/login` | `login`, `password`; cookie + **`accessToken`**. |
| `POST` | `/api/teleoperator/logout` | Clear cookie. |
| `GET` | `/api/teleoperator/me` | Profile: cookie **`teleop_token`** or **`Authorization: Bearer`**. |
| `POST` | `/api/robots/{id}/teleop/help` | Robot requests help (LAN): **`X-Robot-Teleop-Secret`**, JSON with required string **`message`** and **`metadata`** (normalized: **`task_id`**, **`error_context`**, **`situation_report`** — strings, empty if omitted; optional long UTF-8 **`situation_report`** up to ~64 KiB, truncated; optional **`kyr_peaq_context`** object up to 64 KiB JSON, else **413**). Response: **`helpRequest`**, **`duplicate`**, top-level **`id`**, optional **`peaq_claim`** when Peaq configured. Signed SessionGrant for KYR is **not** in this response (no operator yet). Missing body/`message` → **400**. Repeat while open → **200** and `duplicate: true`. |
| `GET` | `/api/robots/{id}/teleop/session-grant?helpRequestId=` | Same **`X-Robot-Teleop-Secret`**. After operator **`accept`** and **`TELEOP_GRANT_SIGNING_SECRET_KEY`**: **`teleopGrantPayload`** and **`teleopGrantSignature`**. **404**: `grant_not_ready`, `grant_unconfigured`, `grant_absent`. See [docs/RAID_APP_TELEOP_HELP_FULL_CYCLE_X402_SPEC.md](docs/RAID_APP_TELEOP_HELP_FULL_CYCLE_X402_SPEC.md). |
| `GET` | `/api/robots/{id}/peaq/claim?helpRequestId=` | Same secret. Returns **`{ peaq_claim }`** or **404** `{ "error": "claim_not_ready" }` until ready. **`helpRequestId`** from **`id`** / **`helpRequest.id`** on help response. |
| `GET` | `/api/teleoperator/help-requests` | Open requests (JWT). |
| `POST` | `/api/teleoperator/help-requests/{id}/accept` | Accept → **`session.id`**. If the robot has **any** active **`teleoperator_robot_grants`**, only granted operators may accept; else any logged-in operator. |
| `*` | `/api/teleop/robots/{robotId}/dataset/{path}` | **Proxy** to robot dataset HTTP (method, path after `dataset/`, query preserved). Teleoperator JWT. Same **grants** as help accept. **502** / **504** if upstream fails. See [docs/RAID_APP_DATASET_PROXY_SPEC.md](docs/RAID_APP_DATASET_PROXY_SPEC.md). |

### Teleop proxy — contract for external clients (Unity / Quest / ROSBridge)

Changes in third-party repos are out of scope; below is the integration contract.

1. **Base URL** — same host/port as HTTP API (or **`wss://`** behind a reverse proxy with `Upgrade`).
2. **JWT**: after `POST /api/teleoperator/login` or `register`, store **`accessToken`** (or browser-only cookie `teleop_token`).
3. **Flow**: `GET /api/teleoperator/help-requests` → `POST /api/teleoperator/help-requests/{id}/accept` → response **`session.id`**. Each request’s **`payload`** has **`message`** and **`metadata`** (including **`situation_report`** for VR/UI). WS **`help_request`** carries the same **`data.payload`**. Quest/Unity: [docs/VR_TELEOP_HELP_CLIENT.md](docs/VR_TELEOP_HELP_CLIENT.md).
4. **WebSocket (instead of `ws://<robot>:9090`)**:
   - `ws(s)://<host>:<port>/ws/teleop/session/<sessionId>?token=<URL-encoded JWT>`
   - After connect, send the **same JSON text frames** as direct ROSBridge WebSocket (e.g. `op: subscribe`, `op: publish`).
5. **What the robot sees:** from the Task Router host to `ws://rosbridgeHost:rosbridgePort` a **second** WebSocket runs (server → rosbridge). By default **`X-Teleoperator-Id`** / **`X-Teleoperator-Login`** and query **`teleoperator_id`** / **`teleoperator_login`** are attached for logging/proxy on the robot. Disable with **`TELEOP_FORWARD_OPERATOR_*`**. Stock rosbridge may ignore these.
6. Max frame size: `TELEOP_MAX_MESSAGE_BYTES`. Operator JWT lifetime: **`TELEOPERATOR_JWT_EXPIRES_IN`**. Teleop session row stays open **`TELEOP_SESSION_END_GRACE_MS`** after WS drop, then closes (reconnect with same URL while grace and JWT hold). Reconnect **Task Router → rosbridge**: **`TELEOP_ROSBRIDGE_*_ATTEMPTS`**, **`TELEOP_ROSBRIDGE_RECONNECT_DELAY_MS`**. Code **1011** / reason **`Rosbridge error`** usually means Task Router cannot keep WS to **`rosbridgeHost:rosbridgePort`** (network, rosbridge down, proxy strips headers/query — try **`TELEOP_FORWARD_OPERATOR_*`**).
7. **Dataset over HTTP (Quest / web without LAN to robot):** base URL **`https://<task-router-host>/api/teleop/robots/<robotUuid>/dataset`** — same paths as on the robot. Same JWT; grants apply. Upstream timeout: **`TELEOP_DATASET_PROXY_TIMEOUT_MS`**.

Robot HTTP “request help” (no operator JWT): [docs/TELEOP_FETCH.md](docs/TELEOP_FETCH.md).

#### Paying the teleoperator in SOL (full x402 cycle on robot)

Task Router **does not** spend server SOL for operator work: it issues a **signed SessionGrant** with **`operator_pubkey`** (wallet from DB at registration). **SOL transfer** is done by the **robot** after KYR session end (service **`/x402/complete_teleop_payment`**, same stack as x402 purchases) if enabled on the robot.

**Before testing on Task Router:**

1. In **`.env`**: **`TELEOP_GRANT_SIGNING_SECRET_KEY`** (Solana secret, same format as **`X402_SOLANA_SECRET_KEY`**). Without it **`GET …/teleop/session-grant`** returns **`grant_unconfigured`**.
2. Teleoperator has **`wallet_public_key`** in DB (from registration). Otherwise after accept — **`grant_absent`**.
3. **`GET /health`** → **`teleopGrantSignerPublicKey`**: add this base58 pubkey to robot KYR **`trusted_raid_keys`** ([docs/RAID_APP_TELEOP_HELP_FULL_CYCLE_X402_SPEC.md](docs/RAID_APP_TELEOP_HELP_FULL_CYCLE_X402_SPEC.md)).
4. Flow: robot **`POST …/teleop/help`** → operator **`accept`** → robot polls **`GET …/teleop/session-grant?helpRequestId=`** (help response may include **`teleopGrantPollUrl`**) → before KYR **`open_session`**, pass **`teleopGrantPayload`** / **`teleopGrantSignature`** from Task Router → on session end pay **`operator_pubkey`**.
5. If robot logs show **`pending_from_raid`** / no on-chain transfer: often KYR opened session **before** receiving the grant from Task Router or **does not trust** the signature — compare **`teleopGrantSignerPublicKey`** from **`GET …/session-grant`** or **`GET /health`** with **`trusted_raid_keys`** on the robot. See [docs/RAID_APP_TELEOP_HELP_FULL_CYCLE_X402_SPEC.md §7](docs/RAID_APP_TELEOP_HELP_FULL_CYCLE_X402_SPEC.md).

Full request/response details: **Swagger** (`/docs`). In-app x402 details: [docs/X402_PROTOCOL.md](docs/X402_PROTOCOL.md).

## Robot expectations

- `GET /health` or `/helth` → `{ status, message?, availableMethods?, location? }`.
- `POST /commands/dance`, `POST /commands/buy-cola` with bodies per command.
- For paid endpoints — **402** in V2 shape (`accepts[0].extra.reference`, `payTo`, `amount`, `asset`). For **`any_teleop`** (ROS_X402_PAY) expect HTTP **`POST`** on e.g. **`/x402/any_teleop`** with the same **402** contract; client UI may call **`any_teleop`** via **`/api/client/invoice`** (this service proxies to **`ANY_TELEOP_HTTP_PATH`**).
- Teleop: robot exposes **ROSBridge WebSocket** (often port **9090**) on the same LAN Task Router uses for `rosbridgeHost` / `rosbridgePort`. A script may call **`POST /api/robots/{robotId}/teleop/help`** with the secret set at robot registration ([docs/TELEOP_FETCH.md](docs/TELEOP_FETCH.md)). After accept, outbound rosbridge connection carries **operator id/login** (see **`TELEOP_FORWARD_*`**) — handle in robot proxy if needed.
- Dataset upload from operator client: Task Router must reach **`datasetHttpHost` / `datasetHttpPort`** on LAN (default **`host`** and **9191**). Operators call only Task Router (**`/api/teleop/robots/{id}/dataset/...`**), not the robot directly from the internet.

Example `availableMethods` objects appear in older README revisions or in `swagger.js` (`RobotHealthStatus`).

## Robot integration contract (stability)

The product name **Task-router-x402** and npm package **`task-router-x402`** are **branding and repo layout** only. **Robot, KYR, and operator clients** must keep working without code changes on the robot when you upgrade this service.

**Do not rename or repurpose** wire-level identifiers without a major version / migration plan: HTTP paths, header names, JSON field names used in APIs and Peaq fallbacks, fleet/teleop secrets, and the default **mDNS** hostname (**`raid-app`**). Details and a checklist: [docs/ROBOT_INTEGRATION_STABILITY.md](docs/ROBOT_INTEGRATION_STABILITY.md).

## Scripts

```bash
npm run start
npm run dev
npm test
```

Host with Postgres only from compose (port **5434** on localhost) uses in `.env`:

```bash
DATABASE_URL=postgres://x402:x402@localhost:5434/x402raid
```

**Locale guard:** `test/no-cyrillic-in-repo.test.js` fails if Cyrillic appears under `src/`, `public/`, `docs/`, `config/`, etc. (public repo policy; see [CONTRIBUTING.md](CONTRIBUTING.md)). Local `.env` is not scanned.

Tests **do not read** `DATABASE_URL`: integration suites use only **`TEST_DATABASE_URL`**. If unset, those tests are skipped and `npm test` still passes. Example using the same DB as in `config/env.example` (do **not** point at production — tests **`TRUNCATE`**):

```bash
export TEST_DATABASE_URL=postgres://x402:x402@localhost:5434/x402raid
docker compose up -d postgres   # or full stack
npm test
```

## Extending

- New commands: `src/services/commandRouter.js`, routes in `src/routes/commands.js`, **update Swagger** (`@openapi` + `components.schemas` in `src/docs/swagger.js` if needed).
- Strategy changes without code: `COMMAND_DANCE_STRATEGY`, `COMMAND_BUY_COLA_STRATEGY`, `PRICING_MARKUP_PERCENT`.
- Production: protect public API with keys/auth, change `ADMIN_PASSWORD`, use persistent registry instead of memory-only.

## Documentation index

- [CHANGELOG.md](CHANGELOG.md) — summary of recent changes (use for PR descriptions).
- [CONTRIBUTING.md](CONTRIBUTING.md) — language policy, OpenAPI, tests, and commit expectations for this repo.
- [docs/CLIENT_UI.md](docs/CLIENT_UI.md) — public `/client` UI: modes, wallet, API usage.
- [docs/X402_PROTOCOL.md](docs/X402_PROTOCOL.md) — x402 client flow and robot **402** retry.
- [docs/RAID_APP_TELEOP_HELP_SPEC.md](docs/RAID_APP_TELEOP_HELP_SPEC.md) — robot **`POST …/teleop/help`** body (`message`, `metadata`, `situation_report`, Peaq context).
- [docs/TELEOP_FETCH.md](docs/TELEOP_FETCH.md) — HTTP `teleop/help` from the robot (`teleop_fetch`) and WS/rosbridge.
- [docs/VR_TELEOP_HELP_CLIENT.md](docs/VR_TELEOP_HELP_CLIENT.md) — **`payload.metadata.situation_report`** for VR/operator UI.
- [docs/ROBOT_INTEGRATION_STABILITY.md](docs/ROBOT_INTEGRATION_STABILITY.md) — **stable vs cosmetic** naming; what robots and KYR must not break on upgrade.
- [docs/ROBOT_SIDE_AI_AGENT.md](docs/ROBOT_SIDE_AI_AGENT.md) — guide for **robot-side code**: enroll, secrets, help, allowlist, rosbridge.
- [docs/ROBOT_OPERATOR_SYNC.md](docs/ROBOT_OPERATOR_SYNC.md) — operator allowlist push to the robot (`RAID_TO_ROBOT_SECRET`, `X-Raid-To-Robot-Secret`).
- [docs/ROBOT_TELEOP_KYR_RAID_GRANT.md](docs/ROBOT_TELEOP_KYR_RAID_GRANT.md) — Task Router → KYR: SessionGrant, `trusted_raid_keys`, `pending_from_raid`, operator payment.
- [docs/RAID_APP_TELEOP_HELP_FULL_CYCLE_X402_SPEC.md](docs/RAID_APP_TELEOP_HELP_FULL_CYCLE_X402_SPEC.md) — full teleop + x402 + SessionGrant cycle.
- [docs/RAID_APP_PEAQ_CLAIM_SPEC.md](docs/RAID_APP_PEAQ_CLAIM_SPEC.md) — Peaq claim on help requests (Agung / dev).
- [docs/RAID_APP_DATASET_PROXY_SPEC.md](docs/RAID_APP_DATASET_PROXY_SPEC.md) — operator dataset HTTP proxy **`/api/teleop/robots/{id}/dataset/*`**.
- [docs/DATA_NODE_OPERATOR_SESSION_SPEC.md](docs/DATA_NODE_OPERATOR_SESSION_SPEC.md) — DATA_NODE multipart / session metadata (adjacent ingest pipeline; robot uploads).
- [docs/SPRINT_SEMAPHORE_X402_RAID_APP.md](docs/SPRINT_SEMAPHORE_X402_RAID_APP.md) — sprint deliverables vs this repo’s scope.

## Public repository and secrets

Before pushing, ensure history and index contain **no** real keys or passwords:

- **`.env`** and variants (`.env.local`, etc.) — local only; the repo keeps **`config/env.example`** with placeholders.
- **`config/client-settings.json`** — in `.gitignore`; document fields in README without real values.
- Do not commit **archives** (`*.zip`, etc.) with repo snapshots or `node_modules` — they bloat history and may leak secrets.
- Check: `git ls-files | grep -Ei '\.(env|pem|key)$'` and review `git diff --staged` for accidental API keys.

## Misc

- Logs — structured strings (`src/utils/logger.js`).
- Express errors go through the shared handler in `src/index.js`.

External x402 reference: [x402 Register Resource](https://www.x402scan.com/resources/register).
