# RAID App: peaq claim for teleop (Agung / dev)

**Audience:** developers of **Task-router-x402** (`task-router-x402`, Node.js).  
**Robot-side:** `rospy_x402` sends KYR issuance context in `POST …/teleop/help` and fetches a claim via `GET …/peaq/claim`. Peaq SDK usage ([Onboard a Machine](https://docs.peaq.xyz/build/first-depin/onboard-machine), [DID Operations](https://docs.peaq.xyz/sdk-reference/javascript/did-operations)) runs **on Task-router-x402**, not on the robot.

**Related:** [RAID_APP_TELEOP_HELP_SPEC.md](RAID_APP_TELEOP_HELP_SPEC.md) (this repo), [RAID_APP_TELEOP_HELP_SPEC.md in `rospy_x402`](../../rospy_x402/DOC/RAID_APP_TELEOP_HELP_SPEC.md) (on-robot package, if present in your workspace).

---

## 1. Extend `POST /api/robots/{robotId}/teleop/help`

Existing body and headers unchanged (`X-Robot-Teleop-Secret`, `message`, `metadata`).

**New optional field** inside `metadata`:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `kyr_peaq_context` | object | no | KYR-issued JSON for binding a peaq DID/claim to this help request. Produced by ROS service `/kyr/get_peaq_issuance_metadata` (package `KYR`). |

Recommended shape of `kyr_peaq_context` (robot populates; RAID treats as opaque except for correlation):

```json
{
  "schema_version": 1,
  "robot_id": "string",
  "task_id": "string",
  "error_context": "string",
  "kyr_session_id": "",
  "kyr_session_active": false,
  "issued_at_unix": 1710000000
}
```

- `kyr_session_id`: non-empty if a KYR session was already open (unusual before grant; may be empty during help).
- RAID should persist `kyr_peaq_context` with the help request row for audit.

---

## 2. Help response: `help_request_id` and optional inline claim

Ensure the JSON response includes a stable identifier for the created help request:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string (UUID) | **Required** for claim fetch. Existing robots already use this as `helpRequestId`. |

**Optional:** include an immediate claim (if synchronous issuance is cheap):

| Field | Type | Description |
|-------|------|-------------|
| `peaq_claim` | object | Same schema as §3. If omitted, robot uses GET flow below. |

---

## 3. Claim object schema (`peaq_claim`)

Minimal interoperable object (extend as needed):

```json
{
  "schema_version": 1,
  "network": "peaq-agung",
  "help_request_id": "<uuid>",
  "robot_id": "<raid robot uuid>",
  "issued_at_unix": 1710000000,
  "document": {},
  "raw": {}
}
```

- `document`: peaq DID document or subset from `sdk.did.read` (see peaq docs).
- `raw`: optional full SDK read payload for debugging.

---

## 4. `GET /api/robots/{robotId}/peaq/claim`

**Purpose:** Robot retrieves claim when not inlined in help response.

- **Method:** `GET`
- **Query:** `helpRequestId=<uuid>` (required), same id as `POST …/help` response `id`.
- **Headers:** `X-Robot-Teleop-Secret` (same as teleop/help).

**Responses:**

| Code | Body | Meaning |
|------|------|---------|
| 200 | `{ "peaq_claim": { … } }` | Claim ready. |
| 404 | `{ "error": "claim_not_ready" }` (optional) | Not ready yet; robot may retry. |
| 401 | — | Invalid secret. |

**Polling:** Robot implementation may retry 404 up to ~3 times with ~1 s delay (configurable).

---

## 5. Peaq on RAID (implementation notes)

- Use Agung HTTPS + WSS endpoints from peaq docs (e.g. OnFinality `https://peaq-agung.api.onfinality.io/public` and matching WSS for `did.read`).
- Store machine DID `name` / EVM `address` and SDK secrets in RAID env/config, not on the robot.

### 5.1 External dependencies (faucet, RPC, Peaq SaaS)

- **Testnet gas (AGNG)** comes from Peaq-operated services (docs faucet, etc.). Outages, Cloudflare **524**, CORS on error pages, or third-party paywalls are **outside RAID**; operators obtain gas independently of this app.
- **`POST …/teleop/help` always succeeds** when the help row is created: Peaq failures do **not** turn into 500 for the robot.
- If **`sdk.did.read`** throws or times out in the async path, RAID persists a **fallback** `peaq_claim` so **`GET …/peaq/claim`** does not return **404** forever:

```json
{
  "schema_version": 1,
  "network": "peaq-agung",
  "help_request_id": "<uuid>",
  "robot_id": "<uuid>",
  "issued_at_unix": 1710000000,
  "document": {},
  "raw": {},
  "raid_peaq_read_status": "failed",
  "raid_peaq_error": "<short message>"
}
```

Robots **SHOULD** treat `raid_peaq_read_status === "failed"` as a terminal claim for that help request (no valid DID document); optional logging / operator alert.

---

## 6. Size limits

Recommend cap `metadata.kyr_peaq_context` and `peaq_claim` JSON to ≤ 64 KiB each; respond `413` or truncate per product policy.
