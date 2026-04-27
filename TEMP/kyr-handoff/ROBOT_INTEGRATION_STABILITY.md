# Robot and KYR integration — stable contract vs cosmetic naming

**Task-router-x402** is the **product and repository name**. Robots, KYR stacks, and operator scripts in the field must **keep working** when this service is upgraded, unless you intentionally ship a **breaking** API change with a migration note.

This document lists what is **stable on the wire** (do not rename without a major bump and robot-side updates) versus what is **documentation or packaging only**.

---

## Stable — must stay compatible with deployed robots

| Area | Identifiers | Notes |
|------|-------------|--------|
| **Fleet / robots** | `POST /api/robots/enroll`, `POST /api/robots`, mutating `/api/robots/*` | Headers **`X-Robot-Fleet-Secret`**, **`Authorization: Bearer`** with fleet secret unchanged. |
| **Teleop help** | `POST /api/robots/{robotId}/teleop/help` | Header **`X-Robot-Teleop-Secret`** (or Bearer with same value). Body: **`message`**, **`metadata`** (`task_id`, `error_context`, `situation_report`, optional **`kyr_peaq_context`**). |
| **Session grant** | `GET /api/robots/{robotId}/teleop/session-grant?helpRequestId=` | Same robot secret. Response fields **`teleopGrantPayload`**, **`teleopGrantSignature`**, error codes **`grant_not_ready`**, etc. Semantic: **`grant_not_ready`** also after grant **invalidation** (operator declined before proxy); robot must **drop cached grant** (see [ROBOT_TELEOP_KYR_RAID_GRANT.md](ROBOT_TELEOP_KYR_RAID_GRANT.md)). |
| **Teleoperator session lifecycle** (additive) | `POST /api/teleoperator/sessions/{sessionId}/decline-before-connect`, `POST /api/teleoperator/sessions/{sessionId}/end` | Operator JWT (same as accept). **`decline-before-connect`**: before proxy WS only. **`end`**: JSON **`reason`** in **`graceful_complete`**, **`operator_cancelled`**, **`network_quality_abort`**, **`client_error`** after proxy connected. Paths and JSON field names are stable integration surface for VR/native clients. |
| **Peaq claim** | `GET /api/robots/{robotId}/peaq/claim?helpRequestId=` | JSON fields **`raid_peaq_read_status`**, **`raid_peaq_error`** in stored/returned claims — **semantic contract** for robots parsing failures. |
| **Allowlist push** | `POST` to robot `operatorRegistryUrl` | Header **`X-Raid-To-Robot-Secret`**; env on server **`RAID_TO_ROBOT_SECRET`**. |
| **Outbound WS to rosbridge** | Optional headers/query | **`X-Teleoperator-Id`**, **`X-Teleoperator-Login`**, **`teleoperator_id`**, **`teleoperator_login`** (toggle with **`TELEOP_FORWARD_*`**). |
| **Client API mode** | `POST /api/client/estimate` (and related) | String **`raid`** for Task Router mode remains the API value (UI label may say “Task router”). |
| **KYR / robot trust** | Config on robot | **`trusted_raid_keys`**, log tokens like **`pending_from_raid`** — names live on the **robot/KYR** side; this service still emits compatible grants and help responses. |
| **mDNS default** | **`MDNS_HOSTNAME`** unset | Default remains **`raid-app`** → **`http://raid-app.local:<PORT>`** so scripts that assume this hostname keep working. Set **`MDNS_HOSTNAME`** explicitly to use another name. |
| **Docker volume name** | Compose default | **`x402_raid_pgdata`** — changing the volume name would break **ops** automation, not robot HTTP, but is treated as deployment-stable. |

---

## Cosmetic / repo-only — safe to change without robot code updates

| Item | Examples |
|------|-----------|
| **npm package name** | `task-router-x402` in `package.json`. |
| **README and docs titles** | “Task-router-x402”, “Task Router” in prose. |
| **Swagger UI title** | Display string in `/docs`. |
| **Static HTML `<title>` and headings** | Admin and client pages. |
| **systemd unit filename** | `task-router-x402.service` on the host — path to `node`/`WorkingDirectory` is operator-specific. |
| **CONTRIBUTING.md** | Contributor policy; not read by robots. |

---

## When you may change a “stable” identifier

Treat as a **breaking integration** release:

1. Document the change in **README** and this file (or a **CHANGELOG** entry).
2. Coordinate **robot firmware / KYR / operator script** updates.
3. Prefer **deprecation** (support old header or path for one release) when possible.

---

## Related specs

- [TELEOP_FETCH.md](TELEOP_FETCH.md) — robot HTTP to this service.
- [ROBOT_SIDE_AI_AGENT.md](ROBOT_SIDE_AI_AGENT.md) — robot-side checklist.
- [ROBOT_TELEOP_KYR_RAID_GRANT.md](ROBOT_TELEOP_KYR_RAID_GRANT.md) — SessionGrant and KYR.
- [RAID_APP_TELEOP_HELP_SPEC.md](RAID_APP_TELEOP_HELP_SPEC.md) — help request body.
- [README.md](../README.md) — configuration table and API overview.

**Index:** [README.md](../README.md#documentation-index).
