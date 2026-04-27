# Teleop help: VR / Quest / Unity (operator client)

Summary: help requests include structured context and **`situation_report`**. Operators use JWT auth, HTTP list + accept, optional **decline-before-connect** and **session end** with **`reason`**, then WebSocket to the robot proxy when ready.

## Robot → RAID payload

1. The **robot** calling **`POST /api/robots/{robotId}/teleop/help`** should (per contract) send a body with:
   - **`message`** — string (short label).
   - **`metadata.task_id`**, **`metadata.error_context`** — strings (`error_context` may be empty).
   - **`metadata.situation_report`** — optional long UTF-8 text: what the robot was doing, state, why an operator is needed.

2. **Task-router-x402** normalizes the request: **`payload`** contains **`message`** and **`metadata`** with the three string fields above. If the robot omits `situation_report` or all of `metadata`, missing values become **empty strings** `""`.

3. **`situation_report`** length on the server is capped at **65536** UTF-8 bytes; the tail is truncated without an error for the client.

## VR client: read and display

| Source | Action |
|--------|--------|
| **`GET /api/teleoperator/help-requests`** | Read **`helpRequests[i].payload`**: **`message`**, **`metadata.task_id`**, **`metadata.error_context`**, **`metadata.situation_report`**. |
| **WebSocket** `…/ws/teleoperator?token=…`, event **`help_request`** | Same shape in **`data.payload`**. |
| **Rendering** | Treat **`situation_report`** as plain text (UTF-8). **Do not** inject as HTML without escaping. |
| **Compatibility** | Safe access: `payload?.metadata?.situation_report ?? ""`. |

## Session lifecycle (HTTP + WebSocket)

| Step | Endpoint / URL |
|------|----------------|
| Login / JWT | **`POST /api/teleoperator/login`** or register (see OpenAPI **Teleoperator**). |
| List open tasks | **`GET /api/teleoperator/help-requests`** |
| Take task | **`POST /api/teleoperator/help-requests/{id}/accept`** → **`session.id`** |
| Decline after full brief, **before** robot WS | **`POST /api/teleoperator/sessions/{sessionId}/decline-before-connect`** |
| Connect teleop proxy | **`WebSocket`** **`/ws/teleop/session/{sessionId}?token=<JWT>`** |
| End after proxy connected | **`POST /api/teleoperator/sessions/{sessionId}/end`** body **`{ "reason": "…" }`** — see [VR_TELEOP_SESSION_COMPLETION.md](VR_TELEOP_SESSION_COMPLETION.md) |

**Grant rules:** if the robot has **`teleoperator_robot_grants`**, only granted operators see requests and **`help_request`** events (unchanged).

## API reference

- OpenAPI: **Teleop** and **Teleoperator** tags; **`POST …/decline-before-connect`**, **`POST …/sessions/{sessionId}/end`**.
- Session completion enum and responsibility matrix: [VR_TELEOP_SESSION_COMPLETION.md](VR_TELEOP_SESSION_COMPLETION.md).
- Robot → HTTP: [RAID_APP_TELEOP_HELP_SPEC.md](RAID_APP_TELEOP_HELP_SPEC.md).
