# Robot operator allowlist sync (Task Router → robot)

Task-router-x402 can push the current list of **teleoperator UUIDs** that have an **active grant** for a given robot. This is optional: the robot must expose an HTTP endpoint and store **`operatorRegistryUrl`** on its Task Router registry row (admin UI or API).

## Environment (Task Router)

| Variable | Purpose |
| --- | --- |
| **`RAID_TO_ROBOT_SECRET`** | Shared secret Task Router sends to the robot so the robot can authenticate the caller. |

## Request from Task Router

- **Method**: `POST`
- **URL**: exact value of **`operatorRegistryUrl`** on the robot record (full URL, no path concatenation on the server).
- **Headers**:
  - `Content-Type: application/json`
  - **`X-Raid-To-Robot-Secret`**: same value as `RAID_TO_ROBOT_SECRET`
- **Body**:
```json
{
  "allowedTeleoperatorIds": ["uuid-of-operator-1", "uuid-of-operator-2"]
}
```

The list is derived from **`teleoperator_robot_grants`** (active rows only) for that robot.

## Triggering sync from Task Router

- Admin UI: **Teleop access** page → **Push allowlist to robot**.
- API: **`POST /api/admin/robots/{robotId}/sync-operator-allowlist`** (admin session or Basic Auth).

If `operatorRegistryUrl` is empty or `RAID_TO_ROBOT_SECRET` is unset, the API returns `{ "skipped": true, "reason": "…" }` and does not call the robot.

## Robot implementation checklist

1. Implement `POST` handler on the URL you configure as `operatorRegistryUrl`.
2. Reject requests with missing or wrong **`X-Raid-To-Robot-Secret`** (constant-time compare).
3. Parse JSON and persist **`allowedTeleoperatorIds`** (e.g. file or in-memory for rosbridge/nginx auth).
4. When a teleop session arrives (ROSBridge or HTTP proxy), allow only if the operator id (e.g. from **`X-Teleoperator-Id`**) is in the stored list.

Task Router already forwards operator identity to rosbridge; see [TELEOP_FETCH.md](./TELEOP_FETCH.md).
