# RAID App — `POST …/teleop/help` extension (`situation_report` field)

**Index:** [README.md](../README.md#documentation-index) and [AGENTS.md](../AGENTS.md) list all specs.

**Audience:** Task-router-x402 developers (`task-router-x402` or equivalent).  
**On-robot source:** `rospy_x402` package, `EscalationManager._request_grant_from_raid` → HTTP `POST` to the URL below.

## Endpoint and headers (unchanged)

- **Method:** `POST`
- **Path:** `/api/robots/{robotId}/teleop/help` (`robotId` — UUID from enroll).
- **Headers:**
  - `Content-Type: application/json`
  - `X-Robot-Teleop-Secret` — robot secret from enroll

## JSON request body

The robot sends an object like:

```json
{
  "message": "Need assistance",
  "metadata": {
    "task_id": "string",
    "error_context": "string",
    "situation_report": "string"
  }
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `message` | yes | Short label (as before). |
| `metadata` | yes | Object with request context. |
| `metadata.task_id` | yes | Task / session id on the robot side. |
| `metadata.error_context` | yes | String (often JSON) with machine-readable error details; may be empty. |
| `metadata.situation_report` | **new**, recommended | Free UTF-8 text: **current robot state**, **recent actions**, **why an operator is needed**. May be long (thousands of characters). Legacy clients may omit the key — treat as `""`. |

## RAID-side work

1. **Accept** `metadata.situation_report` in `POST …/teleop/help` (JSON parse).
2. **Persist** it on the help request model and return it to the operator UI/API together with `task_id` / `error_context`.
3. **Backward compatibility:** if the field is missing — do not fail; treat as empty string.
4. **Limits (recommendation):** cap length at API/DB level (e.g. 32–64 KiB), on overflow return `413` or truncate with a log note — per product policy.
5. **Encoding:** UTF-8; do not treat as HTML without escaping in the UI.

## Related ROS API on the robot

Service `rospy_x402/RequestHelp` (`/x402/request_help`): `situation_report` is mirrored to `metadata.situation_report` in the HTTP request.

Robot documentation (handoff bundle): [TASK_ROUTER_FULL_SINC/RAID_INTEGRATION.md](TASK_ROUTER_FULL_SINC/RAID_INTEGRATION.md).

## Implementation in Task-router-x402 (`task-router-x402`)

- Parse/normalize: [`src/utils/teleopHelpPayload.js`](../src/utils/teleopHelpPayload.js), route [`src/routes/teleopHelp.js`](../src/routes/teleopHelp.js).
- **`situation_report`**: stored in JSON **`payload`** on the DB row; returned from **`GET /api/teleoperator/help-requests`**, **`POST …/teleop/help`**, and WS event **`help_request`** (`data.payload`).
- Length limit: **65536** UTF-8 bytes; overflow truncates on code-point boundary with a warning log.
- For VR / Quest / Unity operator clients see [VR_TELEOP_HELP_CLIENT.md](VR_TELEOP_HELP_CLIENT.md).

Optional **`metadata.dataset_id`**, **`kyr_session_id`**, and **`kyr_robot_id`** (DATA_NODE / fleet correlation) are documented in [RAID_APP_DATA_NODE_CORRELATION_SPEC.md](RAID_APP_DATA_NODE_CORRELATION_SPEC.md); the server normalizes them to strings and truncates each at **1024** UTF-8 bytes.
