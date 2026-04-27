# RAID App: peaq claim for teleop (Agung / dev)

**Audience:** developers of `x402_raid_app` (Node.js).  
**Robot-side:** `rospy_x402` sends KYR issuance context in `POST …/teleop/help` and fetches a claim via `GET …/peaq/claim`. Peaq SDK usage ([Onboard a Machine](https://docs.peaq.xyz/build/first-depin/onboard-machine), [DID Operations](https://docs.peaq.xyz/sdk-reference/javascript/did-operations)) runs **on RAID**, not on the robot.

**Related:** [RAID_APP_TELEOP_HELP_SPEC.md](RAID_APP_TELEOP_HELP_SPEC.md) (same bundle), [../RAID_APP_TELEOP_HELP_SPEC.md](../RAID_APP_TELEOP_HELP_SPEC.md) (canonical in this repo), [PEAQ_RAID_CLAIM.md](PEAQ_RAID_CLAIM.md) (Peaq path via robot / dataset). External DATA_NODE multipart spec lives in the `br-vr-dev-sinc` product repo if you need field-level detail.

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
| `peaq_claim` | object | Same schema as §3. If omitted, robot uses GET flow below. **Interoperability:** robot also accepts **`peaqClaim`** (camelCase) if that fits Node better. |

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
| 200 | `{ "peaq_claim": { … } }` or `{ "peaqClaim": { … } }` | Claim ready. |
| 200 | `{ "error": "claim_not_ready" }` (no claim object) | Issuance not finished or blocked upstream (e.g. Peaq wallet/funding). Robot treats as “no claim yet”, same as empty outcome after polls; **fail-open** on robot. |
| 404 | `{ "error": "claim_not_ready" }` (optional) | Not ready yet; robot may retry. |
| 401 | — | Invalid secret. |

**Polling:** Robot implementation may retry **404** up to ~3 times with ~1 s delay (configurable). Implementations that return **200** + `claim_not_ready` without a claim object are handled in one shot (no claim merged until a later successful response includes `peaq_claim` / `peaqClaim`).

---

## 5. Peaq on RAID (implementation notes)

- Use Agung HTTPS + WSS endpoints from peaq docs (e.g. OnFinality `https://peaq-agung.api.onfinality.io/public` and matching WSS for `did.read`).
- Store machine DID `name` / EVM `address` and SDK secrets in RAID env/config, not on the robot.

---

## 6. Size limits

Recommend cap `metadata.kyr_peaq_context` and `peaq_claim` JSON to ≤ 64 KiB each; respond `413` or truncate per product policy.
