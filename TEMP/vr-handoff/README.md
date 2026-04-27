# VR / native teleoperator client — handoff bundle

Snapshot copies from `docs/` for sharing with the VR team. **Canonical:** `docs/VR_TELEOP_HELP_CLIENT.md` and `docs/VR_TELEOP_SESSION_COMPLETION.md`.

## Quick API order

1. JWT: `POST /api/teleoperator/login` (or register).
2. `GET /api/teleoperator/help-requests`
3. `POST /api/teleoperator/help-requests/{id}/accept` → `session.id`
4. **Optional (before `WebSocket`):** `POST /api/teleoperator/sessions/{sessionId}/decline-before-connect`
5. `WebSocket` `/ws/teleop/session/{sessionId}?token=<JWT>`
6. **After proxy active:** `POST /api/teleoperator/sessions/{sessionId}/end` with `{ "reason": "graceful_complete" | "operator_cancelled" | "network_quality_abort" | "client_error" }`

**Payment:** RAID does not send SOL; robot/KYR/x402 settles using receipt after `close_session`.

## Files

| File | Role |
|------|------|
| `VR_TELEOP_HELP_CLIENT.md` | List, payload, WebSocket, endpoint table. |
| `VR_TELEOP_SESSION_COMPLETION.md` | `reason` enum, graceful vs non-graceful, HTTP status codes, responsibility matrix. |
