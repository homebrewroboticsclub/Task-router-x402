# Changelog

All notable changes to this repository are documented here. Dates use commit dates (UTC).

## [Unreleased]

### Sprint 3 closeout coordination (engineering)

- **DATA_NODE** adds **`GET /v1/robots/{robot_id}/stats`** for cloud-visible aggregates (sessions / robot-events / incidents). The Task Router OpenAPI **still** does not expose **`GET /api/robots/{robotId}/stats`** by design ([`test/sprint-inventory-openapi.test.js`](test/sprint-inventory-openapi.test.js)); use DATA_NODE for that stats surface or add a thin proxy in a future release if required.

### Week of 2026-04-07 – 2026-04-13 (PR / public snapshot)

Summary of merged work suitable for reviewers and release notes.

- **2026-04-13 — Dev + admin:** local dev scripts (`scripts/dev-local-up.sh`, `rebuild-local.sh`) and **host Postgres** notes in **`config/env.example`**; **Services registration** — fleet enrollment / RAID-to-robot **secret rotation** APIs, admin UI, and partner-oriented docs.
- **2026-04-12 — Docker & HTTP:** default **host port 3000** for the app; **non-conflicting** alternate compose ports for shared servers; Docker build uses **host network**; **`GET /styles.css`** serves the Tailwind bundle for public UIs.
- **2026-04-12 — Teleoperator VR lifecycle:** **`POST /api/teleoperator/sessions/{sessionId}/decline-before-connect`** and **`…/end`** with **`reason`**; DB support (**`help_request_operator_exclusions`**, **`teleop_sessions.robot_proxy_connected_at`**, **`operator_end_reason`**); **`fix(admin)`** fleet enrollment secret in API and dashboard JS guards.
- **2026-04-12 — UI:** MVP refactor with **Tailwind CSS**; Homebrew **co-brand**, **favicon**, **`/client`** demo cards.
- **2026-04-10 — DATA_NODE & teleop:** fleet **`DATA_NODE_SYNC_*`** and per-robot **`dataNodeSync`** provisioning; optional **`DATA_NODE_INCIDENT_RELAY_*`**; required teleop **`metadata`**; **Services registration** UI/API (first tranche); **DATA_NODE correlation** fields on help metadata; compose/Docker fixes (**npm 11**, teleoperator static assets from **`public/`**).

### Earlier in [Unreleased]

- **Teleoperator session lifecycle (detail):** **`POST /api/teleoperator/sessions/{sessionId}/decline-before-connect`** (reopen help, exclude operator, clear grant before proxy WS) and **`POST /api/teleoperator/sessions/{sessionId}/end`** with **`reason`** after proxy connected; optional operator WS close via registry. Docs **`VR_TELEOP_SESSION_COMPLETION.md`**, handoff copies under **`TEMP/kyr-handoff/`** and **`TEMP/vr-handoff/`**. Robot spec: expanded **`grant_not_ready`** semantics in **`ROBOT_TELEOP_KYR_RAID_GRANT.md`**.

- **DATA_NODE provisioning (RAID → robot):** fleet **`DATA_NODE_SYNC_*`** env, per-robot **`data_node_sync_override`** (JSONB), merged **`dataNodeSync`** on **`POST /api/robots/enroll`** and fleet **POST/PUT/refresh** responses (operator-only fields stripped from device JSON). Admin **POST …/sync-operator-allowlist** accepts **`pushAllowlist`** / **`pushDataNodeSync`**; push body matches **TASK_ROUTER_FULL_SINC** / **ROBOT_OPERATOR_SYNC.md**.
- **Optional help → DATA_NODE relay:** **`DATA_NODE_INCIDENT_RELAY_*`** best-effort POST on new help requests (non-duplicate); failures do not block help.
- **Teleop help:** **`metadata`** is required (plain object, may be `{}`) per **RAID_APP_TELEOP_HELP_SPEC**.
- **Docs / UI:** **`docs/MERMAID_ARCHITECTURE.md`**, **`docs/TASK_ROUTER_FULL_SINC/`** bundle; **`public/teleop-access.html`** — push mode checkboxes and per-robot override editor.
- **Tests:** **`dataNodeSyncProvision`**, **`pushRobotProvisionToRobot`** HTTP mock coverage.

### Added

- **Teleoperators:** registration, login, JWT session (cookie + `accessToken`), cabinet UI; PostgreSQL schema and repositories.
- **Teleop help:** robot `POST /api/robots/{id}/teleop/help`, operator accept, WebSocket hub, duplex **ROSBridge proxy** (`/ws/teleop/session/:id`), grant-based ACL (`teleoperator_robot_grants`), help payload normalization including **`metadata.situation_report`** and optional **`kyr_peaq_context`**.
- **SessionGrant (KYR):** signed grant after accept, **`GET /api/robots/{id}/teleop/session-grant`**, grant signer pubkey on **`GET /health`** when configured.
- **Dataset proxy:** operator-authenticated **`/api/teleop/robots/{robotId}/dataset/*`** to robot dataset HTTP; registry fields **`datasetHttpHost`** / **`datasetHttpPort`**.
- **Robot registry (PostgreSQL):** persistent **`robots`** when **`DATABASE_URL`** is set; fleet **`POST /api/robots/enroll`** with **`enrollmentKey`**; **`operatorRegistryUrl`** and allowlist push (**`RAID_TO_ROBOT_SECRET`**, **`X-Raid-To-Robot-Secret`**).
- **mDNS:** optional LAN advertisement (**`MDNS_ENABLED`**, **`MDNS_HOSTNAME`**; default hostname **`raid-app`** for compatibility).
- **Client API:** **`any_teleop`** estimate/invoice/execute path and related config.
- **Peaq (Agung dev):** optional **`did.read`** claim on teleop help, **`peaq_claim`** storage, **`GET /api/robots/{id}/peaq/claim`**, fallback claim when **`did.read`** fails; scripts **`npm run peaq:onboard`**, **`npm run peaq:faucet`**.
- **Docs:** teleop, VR client, robot-side AI agent, operator sync, KYR grant, full-cycle x402 spec, Peaq claim, dataset proxy, DATA_NODE session multipart spec, sprint inventory vs repo scope, **robot integration stability** (stable wire contract vs branding).
- **Housekeeping:** **`CONTRIBUTING.md`**, **`CHANGELOG.md`**, **`test/no-cyrillic-in-repo.test.js`**, expanded integration tests; **`.gitignore`** tightened for public repo (archives, secrets).

### Changed

- **Project naming:** npm package **`task-router-x402`**; UI and operator docs use **Task-router-x402** / **Task Router** where appropriate. **Wire-level names** (paths, headers, JSON keys such as **`raid_peaq_*`**, client mode **`raid`**, **`RAID_TO_ROBOT_SECRET`**) are **unchanged** for robot compatibility — see **`docs/ROBOT_INTEGRATION_STABILITY.md`**.
- **Admin panel:** JWT cookie session (**`POST /api/admin/login`**) with optional HTTP Basic for **`/api/admin/*`**; static **`/ui`** guard aligned with session.
- **Docker:** compose stack for app + Postgres, persistent volume **`x402_raid_pgdata`**; **`Dockerfile`** for single-port image.
- **Documentation layout:** **`CLIENT_UI.md`**, **`RAID_APP_TELEOP_HELP_SPEC.md`**, **`DATA_NODE_OPERATOR_SESSION_SPEC.md`** moved under **`docs/`**; README **documentation index** with cross-links.
- **Agent / contributor map:** **`AGENTS.md`** is **versioned** in the repository (documentation map for AI assistants; keep in sync with **`README.md`** and **`CONTRIBUTING.md`**).

### Fixed / hardened

- **Peaq:** resilient behavior when RPC/SDK/faucet are unavailable; documented CORS/524 behavior for browser faucet vs CLI.
- **mDNS default** kept as **`raid-app`** so existing **`http://raid-app.local:…`** robot or operator configs keep working without **`.env`** overrides.

### Repository hygiene

- Removed tracked archive artifacts where applicable; avoid committing **`.env`**, **`*.zip`**, and snapshot trees per README and **CONTRIBUTING**.

---

Copy the **Unreleased** section above into your GitHub PR description, or trim to the themes your reviewers care about.
