# Robot teleop integration with RAID: SessionGrant, KYR, and operator payment

**Audience:** Robot software developer (`teleop_fetch`, `rospy_x402`, KYR, `EscalationManager`).  
**Task Router side:** `task-router-x402` repository.  
**Related:** [RAID_APP_TELEOP_HELP_FULL_CYCLE_X402_SPEC.md](RAID_APP_TELEOP_HELP_FULL_CYCLE_X402_SPEC.md), [TELEOP_FETCH.md](TELEOP_FETCH.md).

---

## 1. Symptoms on the robot

After teleop session ends, logs may show:

- `complete_teleop_payment: success but NO on-chain transfer`
- `No valid operator Solana pubkey in receipt`
- references to **`pending_from_raid`**

**Meaning:** **SignedReceipt** from KYR has no valid Solana operator address. It should have come from the **signed SessionGrant** issued by RAID, not a local mock.

---

## 2. What RAID does and does not do

| Action | Where |
|--------|-------|
| Accept help request | `POST /api/robots/{robotId}/teleop/help` + robot secret |
| After operator **accept**, sign SessionGrant with **`operator_pubkey`** (operator wallet from RAID DB) | DB row + **`GET …/teleop/session-grant`** |
| Transfer SOL to operator | **Does not.** Robot pays via `/x402/complete_teleop_payment` and its configured payer |

So if KYR opened with a **mock grant** (`operator_pubkey: pending_from_raid`), the receipt has no real address — this is **wrong step order or untrusted signature on the robot**, not “stale data” in the first `POST …/help`.

---

## 3. Required step order (robot)

```text
1) POST …/teleop/help
      → store helpRequest.id (and teleopGrantPollUrl from response if present)

2) Wait until operator clicks Accept in RAID (human/UI).

3) GET …/teleop/session-grant?helpRequestId=<uuid from step 1>
      → same robot secret header as help
      → 200: teleopGrantPayload (JSON string), teleopGrantSignature (base58), grantSignerPublicKey

4) Parse teleopGrantPayload to object (UTF-8, byte-exact string — spec option A).
      → verify operator_pubkey is valid Solana base58, NOT "pending_from_raid"

5) Pass payload + signature to KYR open_session (your stack: receive_grant / equivalent).
      → trust grant signer on KYR: grantSignerPublicKey (see §5)

6) Teleop session → close_session → complete_teleop_payment with receipt from KYR
```

**Invalid for payment:** call KYR `open_session` with an **internal mock grant** and **never** replace it with RAID data.

---

## 4. HTTP contract (robot → RAID)

### 4.1 Secret

Header: **`X-Robot-Teleop-Secret: <teleopSecret>`**  
(or `Authorization: Bearer <teleopSecret>` — as agreed with RAID.)

**`teleopSecret`** is issued when the robot registers on RAID (enroll / admin).

### 4.2 Help request

```http
POST /api/robots/{robotId}/teleop/help
X-Robot-Teleop-Secret: <secret>
Content-Type: application/json

{ "message": "…", "metadata": { "task_id": "…", … } }
```

When grant signing is enabled on RAID:

- **`id`** / **`helpRequest.id`** — request UUID; **required** for step 3.
- **`teleopGrantPollUrl`** — relative path, e.g.  
  `/api/robots/{robotId}/teleop/session-grant?helpRequestId={id}`  
  (prepend scheme and host, e.g. `https://raid.example`).

### 4.3 Fetch grant (only after operator accept)

```http
GET /api/robots/{robotId}/teleop/session-grant?helpRequestId=<uuid>
X-Robot-Teleop-Secret: <secret>
```

**200 success** (example fields):

| Field | Type | Description |
|-------|------|-------------|
| `teleopGrantPayload` | string | Exact UTF-8 JSON SessionGrant; **do not re-serialize** for KYR signature check |
| `teleopGrantSignature` | string | Ed25519 signature **base58** over **raw UTF-8 bytes** of `teleopGrantPayload` |
| `grantSignerPublicKey` | string | Solana base58 **grant signer** (RAID). Must be in KYR `trusted_raid_keys` |

**404 errors (JSON body, `error` field):**

| error | When |
|-------|------|
| `grant_not_ready` | Request is still **open** (no operator accept yet), **or** the help request was returned to **open** and grant fields were **cleared** (e.g. operator **`decline-before-connect`** after accept but before **`/ws/teleop/session/{sessionId}`**). **Also:** if your poller previously received **200** with a grant, then sees **`grant_not_ready`**, you must **invalidate any cached `teleopGrantPayload` / signature** and keep polling until a **fresh 200** — the old `session_id` in the discarded grant must not be used for KYR. |
| `grant_unconfigured` | `TELEOP_GRANT_SIGNING_SECRET_KEY` not set on RAID |
| `grant_absent` | Operator has no `wallet_public_key` in RAID DB |

Robot strategy: after help, **poll** `session-grant` with backoff until 200 or product timeout. Treat **`grant_not_ready` after a prior success** as **grant revoked** until the next **200**.

---

## 5. Trusting the signature on KYR (`trusted_raid_keys`)

The grant is signed by a **separate** RAID key (Ed25519 / Solana keypair), **not** the operator wallet.

On KYR, allow the public key matching:

- **`grantSignerPublicKey`** from `session-grant`, or
- **`teleopGrantSignerPublicKey`** from **`GET /health`** on the same RAID instance.

If the key is missing or wrong, KYR may reject the grant and stay on mock → **`pending_from_raid`** in receipt again.

---

## 6. SessionGrant contents (after `JSON.parse(teleopGrantPayload)`)

Expected fields (**names as in RAID JSON**):

| Field | Description |
|-------|-------------|
| `session_id` | RAID proxy teleop session UUID (**`session.id`** from operator **accept**). Should align with how KYR/teleop_fetch bind sessions |
| `robot_id` | Robot UUID on RAID |
| `task_id` | From help `metadata.task_id` (may be empty) |
| `operator_pubkey` | **Solana base58** SOL recipient |
| `valid_until_sec` | Grant expiry Unix time |
| `scope_json` | JSON string (policy; RAID may add payment hints) |

If **`operator_pubkey`** is missing or mock placeholder — **do not** call `complete_teleop_payment` expecting on-chain payout to the operator.

---

## 7. Self-check from a workstation

Substitute `RAID_BASE`, `robotId`, `secret`, `helpRequestId` (after accept):

```bash
curl -sS -H "X-Robot-Teleop-Secret: ${SECRET}" \
  "${RAID_BASE}/api/robots/${ROBOT_ID}/teleop/session-grant?helpRequestId=${HELP_ID}"
```

Then:

```bash
# Example: show operator_pubkey from payload (jq)
curl -sS -H "X-Robot-Teleop-Secret: ${SECRET}" \
  "${RAID_BASE}/api/robots/${ROBOT_ID}/teleop/session-grant?helpRequestId=${HELP_ID}" \
  | jq -r '.teleopGrantPayload | fromjson | .operator_pubkey'
```

Expect a non-empty base58 string, not `pending_from_raid`.

---

## 8. Checklist before escalating to RAID team

- [ ] After **accept**, `GET session-grant` returns **200** with non-empty `teleopGrantPayload` and `teleopGrantSignature`.
- [ ] Poller **drops cached grant** when **`grant_not_ready`** appears after a prior **200** (operator may have **decline-before-connect**).
- [ ] Parsed payload **`operator_pubkey`** is valid Solana.
- [ ] **`grantSignerPublicKey`** from RAID is in KYR **`trusted_raid_keys`**.
- [ ] KYR **`open_session`** runs **after** receiving grant from RAID with **those** payload/signature values, not mock-only.
- [ ] Robot has RPC, payer balance, and **`/x402/complete_teleop_payment`** configured (outside RAID).

If all hold and on-chain transfer still fails — inspect Solana/x402 logs **on the robot** (RPC errors, amount, tx signature).

---

## 9. Links

- Full cycle and diagram: [RAID_APP_TELEOP_HELP_FULL_CYCLE_X402_SPEC.md](RAID_APP_TELEOP_HELP_FULL_CYCLE_X402_SPEC.md)  
- HTTP help from robot: [TELEOP_FETCH.md](TELEOP_FETCH.md)  
- RAID OpenAPI: `https://<raid-host>/docs`
