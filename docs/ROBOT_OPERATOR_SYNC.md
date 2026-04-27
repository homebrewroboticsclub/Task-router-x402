# Robot operator allowlist and DATA_NODE provisioning (Task Router → robot)

Task-router-x402 can push two kinds of data to the same HTTP endpoint on the robot (**`operatorRegistryUrl`**): the **teleoperator allowlist** and optional **DATA_NODE batch sync** settings (`dataNodeSync`). The robot merges both per [TASK_ROUTER_FULL_SINC/RAID_INTEGRATION.md](TASK_ROUTER_FULL_SINC/RAID_INTEGRATION.md) and [TASK_ROUTER_FULL_SINC/DATA_NODE_SYNC.md](TASK_ROUTER_FULL_SINC/DATA_NODE_SYNC.md).

## Environment (Task Router)

| Variable | Purpose |
| --- | --- |
| **`RAID_TO_ROBOT_SECRET`** | Shared secret Task Router sends to the robot so the robot can authenticate the caller. |
| **`DATA_NODE_SYNC_*`** | Fleet defaults for `dataNodeSync` (see [README.md](../README.md) env table). If **`DATA_NODE_SYNC_BASE_URL`** is set, fleet provisioning is on unless **`DATA_NODE_SYNC_PROVISION_ENABLED=false`**. |
| **`DATA_NODE_INCIDENT_RELAY_*`** | Optional outbound relay when a new help request is created (see README). |

Per-robot overrides are stored in PostgreSQL as **`dataNodeSyncOverride`** (admin **PUT `/api/admin/robots/{id}`** with JSON body). They merge over fleet env. **`authHeaderValue`** in responses is redacted as **`[redacted]`**; send that placeholder or omit the key on PUT to keep the stored token.

## Request from Task Router

- **Method**: `POST`
- **URL**: exact value of **`operatorRegistryUrl`** on the robot record (full URL, no path concatenation on the server).
- **Headers**:
  - `Content-Type: application/json`
  - **`X-Raid-To-Robot-Secret`**: same value as `RAID_TO_ROBOT_SECRET`
- **Body**: JSON object with **at least one** of:
  - **`allowedTeleoperatorIds`**: array of teleoperator UUID strings (from **`teleoperator_robot_grants`** when pushing allowlist).
  - **`dataNodeSync`**: object in **camelCase** for KYR `data_node_sync_settings.json` merge (see table below).

You may send **both** in one POST (recommended when updating operators and DATA_NODE together). Sending **only** `dataNodeSync` is valid (e.g. token rotation). Sending **only** `allowedTeleoperatorIds` remains valid.

### `dataNodeSync` fields (camelCase)

| Field | Maps to robot `data_node_sync_settings.json` | Notes |
| --- | --- | --- |
| `baseUrl` | `base_url` | Required for a useful sync; no trailing slash. |
| `batchPath` | `batch_path` | Default on robot `/v1/ingest/robot-events`. |
| `enabled` | `enabled` | When `true`, worker may upload (subject to interval). |
| `authHeaderName` | `auth_header_name` | e.g. `Authorization`. |
| `authHeaderValue` | `auth_header_value` | If omitted or empty in the JSON payload, the robot **keeps** the existing token on disk. |
| `intervalSec` | `interval_sec` | Clamped 60–86400 on the robot; Task Router also clamps when building the object. |
| `raidRobotUuid` | `raid_robot_uuid` | Always the robot’s RAID UUID (set by Task Router). |
| `includeDashboardEvents`, `includeAuditEvents`, `includeStateUsbSnapshot`, `includeKyrIncidents` | `include_*` | Booleans. |

**Enroll and refresh:** **`POST /api/robots/enroll`** and fleet **POST/PUT/refresh** responses may include **`dataNodeSync`** when provisioning is configured. **`dataNodeSyncOverride` is never** returned to the device (operator-only).

## Example bodies

Allowlist only:

```json
{
  "allowedTeleoperatorIds": ["uuid-of-operator-1", "uuid-of-operator-2"]
}
```

Both:

```json
{
  "allowedTeleoperatorIds": ["uuid-of-operator-1"],
  "dataNodeSync": {
    "baseUrl": "https://data-node.example",
    "batchPath": "/v1/ingest/robot-events",
    "enabled": true,
    "authHeaderName": "Authorization",
    "authHeaderValue": "Bearer …",
    "intervalSec": 300,
    "raidRobotUuid": "550e8400-e29b-41d4-a716-446655440000",
    "includeDashboardEvents": true,
    "includeAuditEvents": true,
    "includeStateUsbSnapshot": true,
    "includeKyrIncidents": true
  }
}
```

## Triggering sync from Task Router

- Admin UI: **Teleop access** (`/ui/teleop-access.html`) — checkboxes for allowlist / DATA_NODE, then push.
- API: **`POST /api/admin/robots/{robotId}/sync-operator-allowlist`** with optional JSON body:
  - `pushAllowlist` (default `true`)
  - `pushDataNodeSync` (default `true`)

If `operatorRegistryUrl` is empty or `RAID_TO_ROBOT_SECRET` is unset, the API returns `{ "skipped": true, "reason": "…" }` and does not call the robot. If `pushDataNodeSync` is true but neither fleet nor per-robot config yields a payload, the API returns **400**.

## Robot implementation checklist

1. Implement `POST` handler on the URL you configure as `operatorRegistryUrl`.
2. Reject requests with missing or wrong **`X-Raid-To-Robot-Secret`** (constant-time compare).
3. Parse JSON and persist **`allowedTeleoperatorIds`** and/or merge **`dataNodeSync`** into **`~/.kyr/data_node_sync_settings.json`** (see KYR docs).
4. When a teleop session arrives (ROSBridge or HTTP proxy), allow only if the operator id (e.g. from **`X-Teleoperator-Id`**) is in the stored list when your policy uses allowlists.

Task Router already forwards operator identity to rosbridge; see [TELEOP_FETCH.md](./TELEOP_FETCH.md).
