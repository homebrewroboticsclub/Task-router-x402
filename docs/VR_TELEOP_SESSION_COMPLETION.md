# VR / native teleoperator: session completion and decline (HTTP)

**Audience:** VR headset app (Quest / Unity), or any native client using the teleoperator JWT.  
**Canonical robot grant polling:** [ROBOT_TELEOP_KYR_RAID_GRANT.md](ROBOT_TELEOP_KYR_RAID_GRANT.md).  
**Full cycle (x402, KYR):** [RAID_APP_TELEOP_HELP_FULL_CYCLE_X402_SPEC.md](RAID_APP_TELEOP_HELP_FULL_CYCLE_X402_SPEC.md).  
**Context payload:** [VR_TELEOP_HELP_CLIENT.md](VR_TELEOP_HELP_CLIENT.md).

---

## 1. Responsibility split

| Concern | RAID (task-router-x402) | Robot / KYR / x402 |
|--------|-------------------------|-------------------|
| List help, accept, decline-before-connect, POST `/end` with **`reason`**, JWT, WebSocket proxy to rosbridge | Yes | No |
| SessionGrant issue + **`GET …/session-grant`** | Yes | Poll; invalidate cache on **`grant_not_ready`** after a prior **200** |
| **`open_session` / `close_session`**, SignedReceipt, payout amount rules | No | Yes |
| On-chain SOL to operator (`/x402/complete_teleop_payment`) | No | Yes |

RAID stores **`operator_end_reason`** on **`teleop_sessions`** for analytics and product alignment; it does **not** transfer SOL.

---

## 2. Flow summary

1. **`GET /api/teleoperator/help-requests`** → short list.
2. **`POST /api/teleoperator/help-requests/{id}/accept`** → **`session.id`**, help request **claimed**, robot can poll grant.
3. **After full brief, before robot connection:**
   - **`POST /api/teleoperator/sessions/{sessionId}/decline-before-connect`**  
   - Task returns **open** for other operators; **this operator** will not see that help request again; **no** payment (proxy never opened).
4. **After `WebSocket` `/ws/teleop/session/{sessionId}?token=…`** (proxy active):
   - **`POST /api/teleoperator/sessions/{sessionId}/end`** with JSON **`{ "reason": "<enum>" }`**  
   - RAID closes the help request and ends the session row; open operator WebSocket is closed if still connected.
5. **Abrupt disconnect** without HTTP **`/end`**: existing behavior — WebSocket teardown and grace (**`TELEOP_SESSION_END_GRACE_MS`**); **`operator_end_reason`** may stay **NULL**. Payout policy is still **robot/KYR**.

---

## 3. Stable `reason` values (`POST …/end`)

Use **exact** snake_case strings:

| `reason` | Meaning (product / UI) |
|----------|-------------------------|
| **`graceful_complete`** | Operator finished the happy-path flow (e.g. confirmed completion). |
| **`operator_cancelled`** | Operator aborts during an active proxied session. |
| **`network_quality_abort`** | Operator stops due to latency / link quality. |
| **`client_error`** | Client-side fault or guard abort. |

**Do not** send **`brief_declined_before_proxy`** here — use **`decline-before-connect`** only (that reason is stored server-side for the declined session row).

---

## 4. HTTP details

### 4.1 `POST /api/teleoperator/sessions/{sessionId}/decline-before-connect`

- **Auth:** same JWT as accept (cookie or **`Authorization: Bearer`**).
- **Success 200:** `{ ok, helpRequest: { id, robotId, status: "open" } }`.
- **409:** Session not yours, already ended, or proxy already connected (use **`/end`** instead).

### 4.2 `POST /api/teleoperator/sessions/{sessionId}/end`

- **Body:** `{ "reason": "graceful_complete" | "operator_cancelled" | "network_quality_abort" | "client_error" }`.
- **Success 200:** `{ ok, idempotent, reason, helpRequestId }`. **`idempotent: true`** if the session was already ended.
- **400:** Missing or unknown **`reason`**.
- **404:** Session id not found for this operator.
- **409:** Proxy was never connected — use **`decline-before-connect`**.

OpenAPI: **`/docs`**, tag **Teleop**.

---

## 5. Graceful vs non-graceful (headset UX)

- **Graceful:** operator follows the designed completion path; client should call **`/end`** with **`graceful_complete`** when the UI confirms success (in addition to any robot/KYR **`close_session`** your stack already uses).
- **Non-graceful:** **`operator_cancelled`**, **`network_quality_abort`**, **`client_error`**, or **silent WebSocket drop** — map UI events to **`reason`** when possible so RAID logs stay consistent; **reward tier** (full / partial / none) is decided on the **robot** from KYR receipt and product rules, not from this HTTP body alone.

---

## Related

- [VR_TELEOP_HELP_CLIENT.md](VR_TELEOP_HELP_CLIENT.md) — list, WebSocket **`help_request`**, **`situation_report`**.
