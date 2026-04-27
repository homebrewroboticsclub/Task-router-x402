# AGENTS — guidance for AI coding agents

Human-oriented narrative, quick start, and API tables live in [README.md](README.md). Use this file for **repo layout**, **constraints**, and a **single map** of all documentation.

## Project in one paragraph

**Task-router-x402** (`task-router-x402`): a **Homebrew Robotics** Node.js (Express) service that orchestrates **x402** payments, robot registry, command routing, public **`/client`** UI, admin **`/ui`**, and (with **`DATABASE_URL`**) teleoperator auth, help requests, ROSBridge proxy WebSockets, dataset HTTP proxy, and optional Peaq claims. OpenAPI: **`/docs`**, **`/docs-json`**. Brand assets: **`npm run build:brand`** (from **`temp/HBR.jpg`**) → **`public/brand/`**, **`public/favicon.ico`**.

## Where to change code

| Area | Paths |
|------|--------|
| HTTP routes | `src/routes/`, mounted from `src/index.js` |
| x402 / Solana client | `src/services/`, `src/config.js` |
| Teleop help, session grant, Peaq | `src/routes/teleopHelp.js`, `src/utils/teleopHelpPayload.js`, related services |
| WebSocket teleop | `src/ws/teleopServer.js` |
| OpenAPI | `src/docs/swagger.js` + `/** @openapi */` on route files |
| Public / admin / teleoperator static UI | `public/` |
| Docker / deploy | `Dockerfile`, `docker-compose.yml`, `deploy/` |
| Example env | `config/env.example` (keep in sync with code) |

## Rules agents must follow

- **Language:** committed source, `docs/`, `config/env.example`, UI strings in `public/` — **English only**. `npm test` includes `test/no-cyrillic-in-repo.test.js`. See [CONTRIBUTING.md](CONTRIBUTING.md).
- **API contract:** any new or changed public HTTP surface → update JSDoc `@openapi` and `src/docs/swagger.js` as needed.
- **Stability:** robot-facing paths, headers, and JSON field names are **not** renamed for cosmetics. See [docs/ROBOT_INTEGRATION_STABILITY.md](docs/ROBOT_INTEGRATION_STABILITY.md).
- **Database tests:** integration tests must use **`TEST_DATABASE_URL`**, never production or compose **`DATABASE_URL`** (tests may **TRUNCATE** teleop/robot tables).
- **Secrets:** do not commit `.env`, real keys, or `config/services-registration.json` (gitignored).

## Commands

```bash
npm install
npm run dev      # nodemon
npm run start    # production
npm run build:css   # Tailwind → public/styles.css
npm run build:brand # optional; needs temp/HBR.jpg — mark PNGs + favicon.ico
npm test         # includes locale guard; PG tests skip without TEST_DATABASE_URL
```

## Documentation index (complete)

### Root

- [README.md](README.md) — features, quick start, env tables, API summary, integration notes.
- [CHANGELOG.md](CHANGELOG.md) — recent changes (useful for PR context).
- [CONTRIBUTING.md](CONTRIBUTING.md) — contribution and CI expectations.
- [AGENTS.md](AGENTS.md) — this file.

### Specs and guides (`docs/`)

- [docs/CLIENT_UI.md](docs/CLIENT_UI.md) — public `/client` UI.
- [docs/X402_PROTOCOL.md](docs/X402_PROTOCOL.md) — x402 client flow and robot **402** retry.
- [docs/RAID_APP_TELEOP_HELP_SPEC.md](docs/RAID_APP_TELEOP_HELP_SPEC.md) — `POST …/teleop/help` body.
- [docs/RAID_APP_DATA_NODE_CORRELATION_SPEC.md](docs/RAID_APP_DATA_NODE_CORRELATION_SPEC.md) — optional `metadata` correlation fields.
- [docs/DATA_NODE_SYNC.md](docs/DATA_NODE_SYNC.md) — KYR → DATA_NODE batch sync (not implemented in this Node app; robot/KYR).
- [docs/TELEOP_FETCH.md](docs/TELEOP_FETCH.md) — robot HTTP client to teleop help.
- [docs/VR_TELEOP_HELP_CLIENT.md](docs/VR_TELEOP_HELP_CLIENT.md) — VR/operator clients, `situation_report`.
- [docs/VR_TELEOP_SESSION_COMPLETION.md](docs/VR_TELEOP_SESSION_COMPLETION.md) — decline-before-connect, `POST …/end` + `reason`, RAID vs KYR payout.
- [docs/ROBOT_INTEGRATION_STABILITY.md](docs/ROBOT_INTEGRATION_STABILITY.md) — stable wire contract checklist.
- [docs/ROBOT_SIDE_AI_AGENT.md](docs/ROBOT_SIDE_AI_AGENT.md) — robot-side integrator checklist.
- [docs/ROBOT_OPERATOR_SYNC.md](docs/ROBOT_OPERATOR_SYNC.md) — allowlist + `dataNodeSync` push to robot.
- [docs/SERVICES_REGISTRATION_ROBOT.md](docs/SERVICES_REGISTRATION_ROBOT.md) — robot stack: operator registry, RAID↔robot secrets, Services registration UI.
- [docs/SERVICES_REGISTRATION_DATA_NODE.md](docs/SERVICES_REGISTRATION_DATA_NODE.md) — DATA_NODE operators: what RAID stores, UI probe, relay.
- [docs/MERMAID_ARCHITECTURE.md](docs/MERMAID_ARCHITECTURE.md) — architecture diagram.
- [docs/ROBOT_TELEOP_KYR_RAID_GRANT.md](docs/ROBOT_TELEOP_KYR_RAID_GRANT.md) — SessionGrant, `trusted_raid_keys`.
- [docs/RAID_APP_TELEOP_HELP_FULL_CYCLE_X402_SPEC.md](docs/RAID_APP_TELEOP_HELP_FULL_CYCLE_X402_SPEC.md) — full teleop + x402 + grant cycle.
- [docs/RAID_APP_PEAQ_CLAIM_SPEC.md](docs/RAID_APP_PEAQ_CLAIM_SPEC.md) — Peaq claim on help (canonical in this repo).
- [docs/RAID_APP_DATASET_PROXY_SPEC.md](docs/RAID_APP_DATASET_PROXY_SPEC.md) — dataset HTTP proxy `/api/teleop/robots/{id}/dataset/...`.
- [docs/DATA_NODE_OPERATOR_SESSION_SPEC.md](docs/DATA_NODE_OPERATOR_SESSION_SPEC.md) — DATA_NODE session multipart metadata.
- [docs/SPRINT_SEMAPHORE_X402_RAID_APP.md](docs/SPRINT_SEMAPHORE_X402_RAID_APP.md) — sprint scope vs this repo.

### Handoff bundle (`docs/TASK_ROUTER_FULL_SINC/`)

Snapshots copied from other product repos; **canonical** specs for day-to-day work are usually the copies in `docs/` above. The bundle [docs/TASK_ROUTER_FULL_SINC/README.md](docs/TASK_ROUTER_FULL_SINC/README.md) lists each file and its upstream **SOURCE**.

| File in bundle | Role |
|----------------|------|
| [RAID_INTEGRATION.md](docs/TASK_ROUTER_FULL_SINC/RAID_INTEGRATION.md) | Robot ↔ RAID integration narrative |
| [X402_PROTOCOL.md](docs/TASK_ROUTER_FULL_SINC/X402_PROTOCOL.md) | x402 (snapshot) |
| [ARCHITECTURE.md](docs/TASK_ROUTER_FULL_SINC/ARCHITECTURE.md) | Architecture (snapshot) |
| [ROSBRIDGE_AND_RAID.md](docs/TASK_ROUTER_FULL_SINC/ROSBRIDGE_AND_RAID.md) | Rosbridge + RAID |
| [DATA_NODE_SYNC.md](docs/TASK_ROUTER_FULL_SINC/DATA_NODE_SYNC.md) | Robot-side DATA_NODE sync (snapshot) |
| [DATA_NODE_INGEST_AND_EVENTS_SPEC.md](docs/TASK_ROUTER_FULL_SINC/DATA_NODE_INGEST_AND_EVENTS_SPEC.md) | DATA_NODE ingest / batch |
| [RAID_APP_*](docs/TASK_ROUTER_FULL_SINC/) | Parallels of RAID specs (verify against `docs/` if they differ) |
| [PEAQ_RAID_CLAIM.md](docs/TASK_ROUTER_FULL_SINC/PEAQ_RAID_CLAIM.md) | Peaq path across robot / dataset |

Many links inside `TASK_ROUTER_FULL_SINC/*.md` point at **sibling repositories** (`rospy_x402`, `br-kyr`, …) and are **expected to 404 inside this clone**; use the bundled file or the `docs/` canonical spec when both exist.

## External reference

- [x402 Register Resource](https://www.x402scan.com/resources/register)
