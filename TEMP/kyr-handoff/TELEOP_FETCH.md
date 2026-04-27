# Robot integration with Task-router-x402 (`teleop_fetch` role)

This document describes the **HTTP call from the robot** to **Task-router-x402** (informal name **`teleop_fetch`**: script, ROS node, systemd, etc.) and **what the robot sees** after an operator accepts and the ROSBridge proxy is active.

See also: [README.md](../README.md) (`TELEOP_*` table, Docker, health), [ROBOT_SIDE_AI_AGENT.md](./ROBOT_SIDE_AI_AGENT.md) (checklist for robot-side code), source [`src/routes/teleopHelp.js`](../src/routes/teleopHelp.js), [`src/ws/teleopServer.js`](../src/ws/teleopServer.js).

---

## What `teleop_fetch` does

Usually **one action**: tell Task-router-x402 the robot needs help — **`POST /api/robots/{robotId}/teleop/help`**.

This call **does not** need teleoperator JWT, cookies, or WebSocket; the operator and VR use those **after** accept.

---

## Requirements on Task-router-x402

Without these the help route is **not mounted** (requests to `/api/robots/.../teleop/help` are not handled as teleop):

1. **`DATABASE_URL`** and **`TELEOPERATOR_JWT_SECRET`** are set — tables exist, `/api/teleoperator/*`, **`/api/robots/.../teleop/help`**, UI `/teleoperator` are wired.
2. The robot is **registered** in the registry: admin **`/ui`** (**`/api/admin/robots`**), or **`POST /api/robots/enroll`** with **`ROBOT_FLEET_ENROLLMENT_SECRET`** (header **`X-Robot-Fleet-Secret`** or **`Authorization: Bearer`**), or **`POST /api/robots`** with the same secret or admin session.
3. The robot row has **`teleopSecret`** (from enroll/admin API; public **`GET /api/robots`** does **not** return it).

Check: **`GET /health`** — **`teleoperatorEnabled: true`** when DB is connected; **`teleopWs: true`** when teleop WebSocket is enabled (`TELEOP_WS_ENABLED` not `false`/`0`).

### Registry registration (`POST /api/robots/enroll`)

Recommended path: call **`POST /api/robots/enroll`** once (and when IP/host changes) with the same **`enrollmentKey`** (stable device id in your config).

| Parameter | Value |
|-----------|-------|
| **URL** | `http(s)://<TASK_ROUTER_HOST>:<PORT>/api/robots/enroll` |
| **Fleet auth** | **`X-Robot-Fleet-Secret: <ROBOT_FLEET_ENROLLMENT_SECRET>`** or **`Authorization: Bearer <same secret>`** |
| **Body (JSON)** | Required **`enrollmentKey`**, **`host`**, **`port`**; optional **`name`**, **`rosbridgeHost`**, **`rosbridgePort`**, **`teleopSecret`** (server generates if omitted), **`operatorRegistryUrl`** (allowlist push, see [ROBOT_OPERATOR_SYNC.md](./ROBOT_OPERATOR_SYNC.md)) |

Response: full robot object including **`id`** (store as **`robotId`**) and **`teleopSecret`**. Repeat with the same **`enrollmentKey`** updates the row (same **`id`**).

**Discovering `TASK_ROUTER_HOST`:** with default mDNS, **`http://raid-app.local:3000`** (default **`MDNS_HOSTNAME=raid-app`**). If the operator sets **`MDNS_HOSTNAME`**, use **`http://<that-name>.local:<PORT>`** instead. See README and [ROBOT_INTEGRATION_STABILITY.md](ROBOT_INTEGRATION_STABILITY.md).

---

## HTTP contract for `teleop_fetch`

| Parameter | Value |
|-----------|-------|
| **Method** | `POST` |
| **URL** | `http(s)://<HOST>:<PORT>/api/robots/<robotId>/teleop/help` |
| **`robotId`** | UUID from **`POST /api/robots/enroll`** or admin **`POST /api/admin/robots`** (not the robot’s `host:port`). |
| **Robot secret** | Header **`X-Robot-Teleop-Secret: <secret>`** — same as in registry. **Or** **`Authorization: Bearer <secret>`** (same value). |
| **Body** | JSON: required string **`message`**. **`metadata`** recommended: strings **`task_id`**, **`error_context`** (may be empty), optional **`situation_report`** — free UTF-8 state text (up to ~64 KiB UTF-8 bytes, server truncates longer). If **`metadata`** is missing, the server fills those fields with empty strings. Extra keys under **`metadata`** are preserved. |
| **Content-Type** | With body: `application/json`. |

### Responses

| Code | Meaning |
|------|---------|
| **201** | New request; body has `helpRequest`, **`duplicate: false`**. |
| **200** | Open request already exists; same shape, **`duplicate: true`**. |
| **401** | Missing/wrong secret or robot has no `teleopSecret`. |
| **404** | No such `robotId` in registry. |
| **400** | Missing or non-string **`message`**. |
| **500** | Server/DB error. |

After **201/200** a **`help_request`** event is sent on **`/ws/teleoperator?token=…`**: if the robot has active **`teleoperator_robot_grants`** rows, only those operators; otherwise all connected clients with valid JWT. The robot does not need to open anything extra for this.

### Example (`curl`)

```bash
curl -sS -X POST \
  "http://TASK_ROUTER_HOST:3000/api/robots/ROBOT_UUID/teleop/help" \
  -H "Content-Type: application/json" \
  -H "X-Robot-Teleop-Secret: your-shared-secret" \
  -d '{"message":"Need assistance","metadata":{"task_id":"run-1","error_context":"","situation_report":"Near door; navigation stalled.","battery":12}}'
```

### `teleopSecret` requirements

There is **no** minimum length in code: empty string means “teleop disabled” for that robot. In production use a **long random** secret like an API key.

---

## Operator identity on the robot (outbound WS Task Router → rosbridge)

This is **not** part of `teleop_fetch`: it applies **after** the operator calls **`POST /api/teleoperator/help-requests/{id}/accept`** and connects to **`/ws/teleop/session/{sessionId}?token=…`**.

Then **Task-router-x402** opens its **own** client WebSocket to **`ws://rosbridgeHost:rosbridgePort`** (robot card fields; default `rosbridgeHost = host`, port **9090**).

**The JWT is not sent to the robot.** Only **stable profile fields**:

| Channel | Name | Value |
|---------|------|-------|
| HTTP header | **`X-Teleoperator-Id`** | Teleoperator user UUID in PostgreSQL (= JWT **`sub`**). |
| HTTP header | **`X-Teleoperator-Login`** | Login from JWT **only if** present when the token was issued. |
| Query | **`teleoperator_id`** | Same as `X-Teleoperator-Id`. |
| Query | **`teleoperator_login`** | Same as login; **omitted** if no login. |

Example URL (paths to rosbridge aside; often `ws://IP:9090?teleoperator_id=…&teleoperator_login=…`):

```text
ws://192.168.1.10:9090?teleoperator_id=a1b2c3d4-e5f6-7890-abcd-ef1234567890&teleoperator_login=operator1
```

**Stock rosbridge** may **ignore** these headers and query. They are usually read by **nginx / another proxy** in front of rosbridge or a custom wrapper.

### Disabling forwarding (Task Router side only)

| Variable | Default | If `false` / `0` / `no` / `off` |
|----------|---------|--------------------------------|
| **`TELEOP_FORWARD_OPERATOR_HEADERS`** | on | Do not send **`X-Teleoperator-*`**. |
| **`TELEOP_FORWARD_OPERATOR_QUERY`** | on | Do not append **`teleoperator_*`** to the URL. |

Empty env values keep **defaults** (enabled). Implementation: **`buildRosbridgeWebSocketTarget`** in [`src/ws/teleopServer.js`](../src/ws/teleopServer.js), flags in [`src/config.js`](../src/config.js) (`forwardOperatorHeaders` / `forwardOperatorQuery`).

**Reconnects and WS session lifetime** (same `teleopServer.js` + README env): **`TELEOP_ROSBRIDGE_CONNECT_ATTEMPTS`**, **`TELEOP_ROSBRIDGE_RECONNECT_DELAY_MS`**, **`TELEOP_ROSBRIDGE_DROP_RECONNECT_ATTEMPTS`**, **`TELEOP_SESSION_END_GRACE_MS`**. Operator JWT still **`TELEOPERATOR_JWT_EXPIRES_IN`**.

---

## Network and security

- Robot and Task-router-x402 must reach each other (often **LAN** for HTTP `teleop/help` and outbound WS to rosbridge).
- Do not log full `teleopSecret`.
- CORS allows **`X-Robot-Teleop-Secret`** and **`X-Robot-Fleet-Secret`** for browsers; typical `teleop_fetch` on the robot is **server-to-server**, no CORS.

---

## Do you need to change `teleop_fetch` code

Change **only if** the **POST …/teleop/help** contract is wrong (URL, method, secret header, robot UUID). Forwarding **`teleoperator_*`** is configured on **Task-router-x402** and on the robot **proxy/rosbridge stack**; `teleop_fetch` usually needs **no** extra logic for that.

---

## OpenAPI

**Teleop** tag, **`POST /api/robots/{robotId}/teleop/help`** — interactive at **`/docs`**.
