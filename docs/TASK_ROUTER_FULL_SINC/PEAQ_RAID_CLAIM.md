# Peaq claim via RAID (robot side)

Peaq DID/claim issuance runs on **RAID** (Node.js + peaq SDK). The robot only sends KYR context in `teleop/help` and fetches `peaq_claim` over HTTP.

## Flow

1. **KYR** — service `/kyr/get_peaq_issuance_metadata` returns JSON for `metadata.kyr_peaq_context` in `POST …/teleop/help`.
2. **rospy_x402** — `EscalationManager` merges that object, then reads `peaq_claim` from the help response or polls `GET /api/robots/{robotId}/peaq/claim?helpRequestId=…` (see [RAID_APP_PEAQ_CLAIM_SPEC.md](RAID_APP_PEAQ_CLAIM_SPEC.md) or [../RAID_APP_PEAQ_CLAIM_SPEC.md](../RAID_APP_PEAQ_CLAIM_SPEC.md)).
3. **teleop_fetch** — service `/teleop_fetch/set_peaq_dataset_claim` writes `peaqClaim` into the dataset `metadata.json`; **dataset_upload_server** adds multipart part `peaqClaim` on push to DATA_NODE (multipart field details: `br-vr-dev-sinc` / `DATA_NODE_PEAQ_CLAIM_SPEC`, not vendored here).

## rosparam (x402 node private namespace)

| Parameter | Default | Description |
|-----------|---------|-------------|
| `raid_peaq_claim_enabled` | `true` | If `false`, skip GET claim and dataset merge. |
| `raid_send_kyr_peaq_context` | `true` | If `false`, do not add `metadata.kyr_peaq_context` to `teleop/help` (use if RAID rejects the field). |
| `raid_peaq_dataset_claim_wait_sec` | `5.0` | `wait_for_service` for `/teleop_fetch/set_peaq_dataset_claim` (recorder may start after x402). |
| `raid_peaq_claim_timeout_sec` | `10.0` | HTTP timeout per GET. |
| `raid_peaq_claim_poll_attempts` | `3` | Retries on HTTP 404. |
| `raid_peaq_claim_poll_delay_sec` | `1.0` | Delay between polls. |

Failures are **fail-open**: teleop/help and grant forwarding still succeed if peaq steps fail.

## Operational status (Peaq / RAID)

In field tests (2026-03), RAID has returned **`GET …/peaq/claim` with HTTP 200** and a body like `{"error":"claim_not_ready"}` (no `peaq_claim` / `peaqClaim` object) when **Peaq-side prerequisites are not met** (e.g. test wallet funding / faucet or related infra). That is **expected** until Peaq or ops fix funding; it is **not** a robot regression. The robot still completes **teleop/help** and **SessionGrant** forwarding; only dataset `peaqClaim` stays empty until RAID returns a real claim object.

**Bug reports** for Peaq or RAID issuance belong in those projects; this repo documents robot behavior only.

## RAID JSON field names

Inline help body and GET `peaq/claim` must include a claim object as **`peaq_claim`** or **`peaqClaim`** (dict). If RAID uses another key, the robot will not merge.

## Dataset timing

`set_peaq_dataset_claim` runs **immediately after** a successful `teleop/help` response. It writes into the **currently active** dataset (from `session_state.json`). If no recording is active at that moment, the service returns an error and **`peaqClaim` is not stored** — typical when testing only `rosservice call /x402/request_help` without a parallel `/record_sessions` capture. For end-to-end tests: start dataset recording, then call `request_help` while recording (or extend the pipeline to stash the claim and merge on upload).

## Code

- `src/rospy_x402/raid_peaq_client.py` — HTTP GET client.
- `src/rospy_x402/escalation_service.py` — integration.
