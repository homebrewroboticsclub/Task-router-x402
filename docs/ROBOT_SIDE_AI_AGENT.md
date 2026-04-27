# Guide for agents/developers: robot-side code and Task-router-x402 integration

For an AI agent or human **extending robot software** (ROS node, `teleop_fetch`, systemd, nginx in front of rosbridge, etc.). Describes **how Task-router-x402 works today** and **contracts the robot must follow**. Sources: `task-router-x402` repository (branch/deploy with your team).

**Stability:** rebranding does not change HTTP contracts. See [ROBOT_INTEGRATION_STABILITY.md](ROBOT_INTEGRATION_STABILITY.md) for identifiers that must stay compatible with deployed robots.

---

## 1. Roles and boundaries

| Component | Where it runs | Responsibility |
|-----------|---------------|----------------|
| **Task-router-x402** | Server (Node.js) | Robot registry, fleet secret, enroll, teleop help intake, teleoperator JWT, WS proxy operator ↔ rosbridge, operator↔robot grants table, optional HTTP allowlist push to robot. |
| **Robot** | Your code | HTTP client to Task Router (enroll, help), **local storage** of `robotId`, `teleopSecret`, fleet secret; optionally **HTTP allowlist server** and/or **filtering inbound** connections to rosbridge (9090). |

**Important:** “mutual auth” is **not symmetric on the wire**. The robot proves itself to Task Router with **HTTP secrets** (fleet + per-robot `teleopSecret`). Task Router **does not** sign the outbound WebSocket to rosbridge separately: the robot sees a normal WS with operator UUID in headers/query. **Trust that this is “legitimate Task Router”** is **your** problem (network, firewall, optional dedicated port for Task Router IP, header checks + allowlist).

---

## 2. Minimum robot configuration

Agree with the fleet operator on values from Task Router `.env` (robots do not invent these; the operator team provides them):

| On robot | Matches on Task Router | Purpose |
|----------|------------------------|---------|
| Base Task Router URL | `http(s)://<host>:<port>` | All API calls. |
| **`ROBOT_FLEET_ENROLLMENT_SECRET`** (same string) | `ROBOT_FLEET_ENROLLMENT_SECRET` in Task Router `.env` | **`POST /api/robots/enroll`** and other mutating `/api/robots` with fleet auth. |
| **`enrollmentKey`** | Not a “secret” on Task Router; stable device id | Idempotent registration: one key → one `robotId`. |
| **`robotId`** (UUID) | `id` field in enroll response | Persist to disk after first successful enroll; use in help URL. |
| **`teleopSecret`** | `teleopSecret` in enroll / admin response | **`POST /api/robots/{robotId}/teleop/help`**. Public **`GET /api/robots`** does **not** expose it. |
| (optional) Allowlist URL | Value for **`operatorRegistryUrl`** on enroll | Full URL of your robot `POST` handler; Task Router calls it on sync (see §7). |
| (optional) **`RAID_TO_ROBOT_SECRET`** (same string) | `RAID_TO_ROBOT_SECRET` in Task Router `.env` | Validate **`X-Raid-To-Robot-Secret`** on your allowlist handler. |

**Discovering Task Router host:** with **`MDNS_ENABLED`**, default **`MDNS_HOSTNAME`** is **`raid-app`** → **`http://raid-app.local:<PORT>`** (stable for existing robot configs). Set **`MDNS_HOSTNAME`** explicitly if you use another `.local` name. Docker + bridge often breaks mDNS — confirm with deploy team.

---

## 3. Talking to Task Router: integration order

### Step A — Enroll (self-registration)

1. **`POST {TASK_ROUTER_BASE}/api/robots/enroll`**
2. Header: **`X-Robot-Fleet-Secret: <ROBOT_FLEET_ENROLLMENT_SECRET>`**  
   **or** **`Authorization: Bearer <ROBOT_FLEET_ENROLLMENT_SECRET>`**
3. JSON body (required):
   - **`enrollmentKey`** — stable string (serial, MAC, firmware UUID).
   - **`host`**, **`port`** — how **other LAN nodes reach the robot HTTP/health** (not localhost if Task Router is elsewhere).
   - Optional: **`rosbridgeHost`**, **`rosbridgePort`** (default port **9090**), **`name`**, **`teleopSecret`** (Task Router generates if omitted), **`operatorRegistryUrl`** (full allowlist API URL).
4. Success: **200**, body is robot object with **`id`**, **`teleopSecret`**, etc. Save **`id`** as `robotId` and **`teleopSecret`** durably.
5. Repeat enroll with same **`enrollmentKey`** **updates** the same row (**same `id`**). Call when IP/port changes or after repair.

If Task Router has no `ROBOT_FLEET_ENROLLMENT_SECRET`, enroll returns **503** — server config, not a robot bug.

Details: [TELEOP_FETCH.md](./TELEOP_FETCH.md) (enroll section).

### Step B — Teleop help request

1. **`POST {TASK_ROUTER_BASE}/api/robots/{robotId}/teleop/help`**
2. Header: **`X-Robot-Teleop-Secret: <teleopSecret>`** or **`Authorization: Bearer <teleopSecret>`**
3. JSON: required string **`message`**. Recommended **`metadata`**: **`task_id`**, **`error_context`** (string, may be `""`), optional **`situation_report`** (long UTF-8 for operator/VR). Without **`metadata`**, Task Router still accepts and fills standard fields with empty strings.
4. **201** — new request; **200** + **`duplicate: true`** — already open (avoid spam). **400** — no string **`message`**.

Operators and VR **do not** hit the robot for this step; they use Task Router (JWT, WebSocket on Task Router).

### Step C — What happens on rosbridge (after operator accept)

When an operator accepts and connects to the proxy, **Task-router-x402** opens an **outbound** WebSocket to **`ws://rosbridgeHost:rosbridgePort`** (from robot card).

By default Task Router adds:

- Headers (unless disabled): **`X-Teleoperator-Id`**, **`X-Teleoperator-Login`**
- Query: **`teleoperator_id`**, **`teleoperator_login`**

**Operator JWT is not sent to the robot.** Operator identity for robot policy is the **PostgreSQL UUID** on Task Router (matches JWT `sub` on Task Router).

Disable on Task Router: **`TELEOP_FORWARD_OPERATOR_HEADERS`**, **`TELEOP_FORWARD_OPERATOR_QUERY`** (see README).

**Your job on the robot:** if you need “operator auth on robot”, implement checks **after** traffic reaches rosbridge (proxy, plugin, wrapper). Stock rosbridge often **ignores** these headers — typical pattern is **nginx** or a dedicated port only for a “trusted” source.

---

## 4. Task Router → robot: operator allowlist push (optional)

If enroll included **`operatorRegistryUrl`**, an admin can trigger sync. Contract: [ROBOT_OPERATOR_SYNC.md](./ROBOT_OPERATOR_SYNC.md):

- **POST** to the **exact** URL (Task Router does not append paths).
- Header **`X-Raid-To-Robot-Secret`** = **`RAID_TO_ROBOT_SECRET`** from Task Router `.env` (must match what you verify on the robot).
- Body: `{ "allowedTeleoperatorIds": ["uuid", …] }` — only operators with **active grant** for that robot on Task Router.

If secret or URL is missing, Task Router **does not** call the robot (sync response: `skipped`).

---

## 5. ACL “who may accept a request” (Task Router logic)

Task Router maintains **`teleoperator_robot_grants`**:

- If the robot has **no** active grant rows — **any** logged-in teleoperator may accept help (**legacy behavior**).
- If there is **at least one** grant — only **granted** operators may accept.

Admin UI: **`/ui/teleop-access.html`** on Task Router (admin session).

The robot does **not** configure this; it only posts help. Consistency with robot allowlist: admin **creates grant on Task Router** and **runs sync** (or you sync lists another way).

---

## 6. Useful endpoints and checks

| Request | Purpose |
|---------|---------|
| **`GET {TASK_ROUTER_BASE}/health`** | `teleoperatorEnabled`, `teleopWs` — is teleop up on Task Router. |
| **`GET {TASK_ROUTER_BASE}/api/robots`** | Public list **without** `teleopSecret` (debug “is our robot registered” via admin `enrollmentKey`, not this GET). |

OpenAPI: **`/docs`**, **`/docs-json`**.

---

## 7. Agent behavior while developing (recommendations)

1. **Do not hardcode secrets** — read from env / permissions file on the robot.
2. **Persistence:** after enroll save `robotId` and `teleopSecret`; on service start read from disk or re-enroll with same `enrollmentKey` (same data if row unchanged).
3. **Network:** Task Router must reach `host:port` (health) and `rosbridgeHost:rosbridgePort`; robot must reach Task Router over HTTP(S).
4. **Timeouts and retries:** enroll and help with backoff; on **401** for help do not retry forever (wrong secret or `robotId`).
5. **Logs:** do not print full secrets or Bearer tokens.
6. **Test without hardware:** run Task-router-x402 locally (docker compose), set secrets, enroll with `host` = robot LAN IP or test bench.

---

## 8. Source map (read the contract)

| Topic | Files |
|-------|-------|
| Enroll and `/api/robots` protection | `src/routes/robots.js`, `src/middleware/robotFleetAuth.js` |
| Help | `src/routes/teleopHelp.js` |
| WS proxy → rosbridge | `src/ws/teleopServer.js` (`buildRosbridgeWebSocketTarget`) |
| Registry, enroll upsert | `src/services/robotRegistry.js`, `src/services/robotRepository.js` |
| Grants, accept | `src/routes/teleopHelp.js`, `src/services/teleoperatorRobotGrantRepository.js` |
| Allowlist push | `src/services/robotOperatorSync.js` |
| mDNS | `src/services/mdnsAdvertisement.js`, `src/config.js` (`mdns`) |

---

## 9. Related docs in this repository

- [TELEOP_FETCH.md](./TELEOP_FETCH.md) — HTTP help and enroll from the robot’s perspective.
- [ROBOT_OPERATOR_SYNC.md](./ROBOT_OPERATOR_SYNC.md) — POST allowlist contract to the robot.
- [README.md](../README.md) — environment variables, API tables, Docker.

If behavior diverges from this doc, **source of truth is code and OpenAPI**; update this file or README after team agreement.
