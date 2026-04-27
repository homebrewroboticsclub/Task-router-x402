# KYR / robot developer — RAID teleop handoff bundle

This folder is a **snapshot copy** of canonical specs from `docs/` for offline sharing. **Source of truth:** the same filenames under `docs/` in the repository.

## Checklist for robot integration

1. **Poll `GET /api/robots/{robotId}/teleop/session-grant?helpRequestId=`** after help; on **200**, use **`teleopGrantPayload`** / **`teleopGrantSignature`** without re-serializing the payload string.
2. If you ever received **200** and then get **`404`** with **`grant_not_ready`**, **discard cached grant data** and keep polling until a new **200** (operator may have used **decline-before-connect**; help is **open** again with cleared grant fields).
3. **No new robot URLs** are required for this feature — only operator-side HTTP on RAID (JWT). Your poller must handle **grant invalidation** as above.
4. **Payout amount and partial/full rules** remain on the robot: KYR **`close_session`**, receipt, **`/x402/complete_teleop_payment`**.

## Files in this folder

| File | Role |
|------|------|
| `ROBOT_TELEOP_KYR_RAID_GRANT.md` | SessionGrant, **`grant_not_ready`** semantics, **`trusted_raid_keys`**. |
| `ROBOT_INTEGRATION_STABILITY.md` | Stable wire identifiers (additive teleoperator paths). |
| `RAID_APP_TELEOP_HELP_FULL_CYCLE_X402_SPEC.md` | Full teleop + x402 cycle; §2.5 operator lifecycle. |
| `TELEOP_FETCH.md` | Robot HTTP client to RAID teleop help. |

Update these copies in the **same PR** when you change the canonical `docs/` versions.
