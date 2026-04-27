# Changelog

All notable changes to this repository are documented here. Dates use UTC; entries reflect work merged **2026-03-24 through 2026-03-31** (suitable for a fork PR summary).

## [Unreleased] — week ending 2026-03-31

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
- **Maintainer automation:** tracked **`AGENTS.md`** removed from the public tree; **`AGENTS.md`** is **gitignored** for local use; public rules summarized in **`CONTRIBUTING.md`**.

### Fixed / hardened

- **Peaq:** resilient behavior when RPC/SDK/faucet are unavailable; documented CORS/524 behavior for browser faucet vs CLI.
- **mDNS default** kept as **`raid-app`** so existing **`http://raid-app.local:…`** robot or operator configs keep working without **`.env`** overrides.

### Repository hygiene

- Removed tracked archive artifacts where applicable; avoid committing **`.env`**, **`*.zip`**, and snapshot trees per README and **CONTRIBUTING**.

---

Copy the **Unreleased** section above into your GitHub PR description, or trim to the themes your reviewers care about.
