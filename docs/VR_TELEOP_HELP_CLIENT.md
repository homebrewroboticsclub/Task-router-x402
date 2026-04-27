# Teleop help: changes for VR / Quest / Unity (operator client)

Summary: help requests now include structured context and **`situation_report`**. URLs, JWT, and the flow “list → accept → WebSocket” are **unchanged**.

## What changed

1. The **robot** calling **`POST /api/robots/{robotId}/teleop/help`** should (per contract) send a body with:
   - **`message`** — string (short label).
   - **`metadata.task_id`**, **`metadata.error_context`** — strings (`error_context` may be empty).
   - **`metadata.situation_report`** — optional long UTF-8 text: what the robot was doing, state, why an operator is needed.

2. **Task-router-x402** always normalizes the request: **`payload`** contains **`message`** and **`metadata`** with the three string fields above. If the robot omits `situation_report` or all of `metadata`, missing values become **empty strings** `""`.

3. **`situation_report`** length on the server is capped at **65536** UTF-8 bytes; the tail is truncated without an error for the client.

## VR client changes

| Source | Action |
|--------|--------|
| **`GET /api/teleoperator/help-requests`** | Read context from **`helpRequests[i].payload`**: show **`payload.message`**, **`payload.metadata.task_id`**, **`payload.metadata.error_context`**, and when useful **`payload.metadata.situation_report`** (main text for the operator). |
| **WebSocket** `…/ws/teleoperator?token=…`, event **`help_request`** | Same: text in **`data.payload`** (same object as in the list). |
| **Rendering** | Treat **`situation_report`** as plain text (UTF-8). **Do not** inject into the UI as HTML without escaping. |
| **Compatibility** | Older rows may have a different **`payload`** shape. Use safe access, e.g. `payload?.metadata?.situation_report ?? ""`. |

## Unchanged

- Operator auth (JWT / cookie).
- Paths **`POST /api/teleoperator/help-requests/{id}/accept`** and **`/ws/teleop/session/{sessionId}?token=`**.
- **Grant** rules (`teleoperator_robot_grants`) for request visibility.

## API reference

- OpenAPI: **Teleop** tag, **`RobotTeleopHelpRequest`** schema, **`POST /api/robots/{robotId}/teleop/help`**.
- Robot → HTTP spec: [RAID_APP_TELEOP_HELP_SPEC.md](RAID_APP_TELEOP_HELP_SPEC.md).
