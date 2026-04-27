# RAID App integration (robot)

HTTP contracts on the RAID side are described in the `x402_raid_app` repository. Here: what **`rospy_x402`** does and which parameters to set.

## Step order

1. **Enroll (A)** — `POST /api/robots/enroll` with fleet secret; response has `id` (robot UUID) and `teleopSecret`. Repeating with the same `enrollmentKey` updates the row; `id` stays stable.
2. **Help (B)** — `POST /api/robots/{robotId}/teleop/help` with `X-Robot-Teleop-Secret` (implemented in `EscalationManager`). JSON body and `metadata.situation_report`: [RAID_APP_TELEOP_HELP_SPEC.md](RAID_APP_TELEOP_HELP_SPEC.md).
3. **Push allowlist + DATA_NODE batch config (optional)** — RAID calls the **exact** URL from `operatorRegistryUrl` on sync: `POST` with header `X-Raid-To-Robot-Secret`. Body is a JSON object that **must** include at least one of:
   - **`allowedTeleoperatorIds`** (array of UUID strings) — updates `~/.ros/raid_operator_allowlist.json` (same as before).
   - **`dataNodeSync`** (object) — merges into **`~/.kyr/data_node_sync_settings.json`** for the KYR background batch uploader (see [DATA_NODE_SYNC.md](DATA_NODE_SYNC.md) §4 and [DATA_NODE_INGEST_AND_EVENTS_SPEC.md](DATA_NODE_INGEST_AND_EVENTS_SPEC.md)).

   RAID may send **both** in one POST (recommended when the task router updates operator list and DATA_NODE endpoint/token together). Sending **only** `dataNodeSync` is valid (e.g. DATA_NODE migration without touching allowlist). Sending **only** `allowedTeleoperatorIds` remains valid.

   **`dataNodeSync` fields (camelCase, all optional except as noted):**

   | Field | Maps to `data_node_sync_settings.json` | Notes |
   |------|----------------------------------------|--------|
   | `baseUrl` | `base_url` | Required for a useful sync; no trailing slash. |
   | `batchPath` | `batch_path` | Default on robot `/v1/ingest/robot-events`. |
   | `enabled` | `enabled` | When `true`, worker may upload (still subject to interval). |
   | `authHeaderName` | `auth_header_name` | e.g. `Authorization`. |
   | `authHeaderValue` | `auth_header_value` | If omitted or empty, existing token on disk is **kept** (rotation: send new value). |
   | `intervalSec` | `interval_sec` | Clamped 60–86400 on save. |
   | `raidRobotUuid` | `raid_robot_uuid` | Batch envelope. |
   | `includeDashboardEvents`, `includeAuditEvents`, `includeStateUsbSnapshot`, `includeKyrIncidents` | `include_*` | Booleans. |

   **Enroll response:** RAID **may** include the same **`dataNodeSync`** object on **`POST /api/robots/enroll`** (200). The robot applies it after saving `id` / `teleopSecret`. Re-enroll or a push with a new `baseUrl` updates the robot without manual UI entry.

   External operator-sync narrative: `ROBOT_OPERATOR_SYNC.md` in RAID (`x402_raid_app`); extend that doc to describe `dataNodeSync` for implementers.

If RAID has **no** `ROBOT_FLEET_ENROLLMENT_SECRET`, enroll returns **503** — server configuration.

## When the robot self-registers (auto-enroll)

The request runs **once at startup** of `x402_ex_server`, **before** the x402 HTTP server starts, and **only if** after the checks below there is still no `robotId` + `teleopSecret` pair:

1. Non-empty `~raid_robot_id` and `~raid_teleop_secret` (or `RAID_ROBOT_ID` / `RAID_TELEOP_SECRET` in env) — then enroll is **not** called.
2. Else read `~/.ros/raid_robot_state.json` (or `RAID_STATE_FILE`) — if it has `id` and `teleopSecret`, enroll is **not** called.
3. Else, if **both** fleet secret **and** `RAID_ENROLLMENT_KEY` **and** `raid_enroll_host` / `RAID_ENROLL_HOST` are set, run `POST …/api/robots/enroll`.

Restart with saved state does **not** hit RAID for enroll until you delete the state file and reset rosparam.

### Already registered on RAID (same `enrollmentKey`)

On RAID enroll is **idempotent**: same key updates the same row, **`id` unchanged**. Our node on **successful** enroll always overwrites the state file with current `id` and `teleopSecret` from the response (if RAID returns a new `teleopSecret`, it is saved).

If the robot **does not** call enroll (credentials from launch or state) but you rotated secrets or deleted the robot on RAID, the old `teleopSecret` in state may be invalid — set new values in launch/env or delete state and restart the node while RAID is reachable (with correct `ROBOT_FLEET_ENROLLMENT_SECRET`).

### RAID unreachable

| Situation | Behaviour |
|-----------|-----------|
| **First** start: no state, enroll needed, RAID down | Log `RAID enroll failed: …`. `robotId`/`teleopSecret` stay empty; node still starts. `teleop/help` and escalation fail until credentials exist (manual entry or successful enroll later). |
| **Subsequent** start: state on disk, enroll skipped | Start without RAID. Help credentials come from file. **Calling** `teleop/help` during escalation still needs RAID **at call time**. |
| First start: enroll failed, **later** RAID is up | Restart `x402_ex_server` (or full launch): retry enroll if no valid pair. Or set `raid_robot_id` / `raid_teleop_secret` once manually. |

There is **no** startup retry/backoff — one enroll attempt per launch; add backoff in systemd/wrapper if needed.

Example values for a test rig (must match RAID `.env`): see `.env.example` in the `rospy_x402` repository (`ROBOT_FLEET_ENROLLMENT_SECRET`, `RAID_TO_ROBOT_SECRET`).

## Persistence

Default state file: `~/.ros/raid_robot_state.json` (`id`, `teleopSecret`). Override: env `RAID_STATE_FILE` or rosparam `~raid_state_file`.

Operator list after sync: `~/.ros/raid_operator_allowlist.json` (next to state), or `RAID_ALLOWLIST_FILE` / `~raid_allowlist_file`.

## Credential priority

1. Non-empty rosparam `~raid_robot_id` and `~raid_teleop_secret` (and/or `RAID_ROBOT_ID`, `RAID_TELEOP_SECRET` in env).
2. Else read saved state file.
3. Else **auto-enroll** if **both** `ROBOT_FLEET_ENROLLMENT_SECRET` (or `~robot_fleet_enrollment_secret`) **and** `RAID_ENROLLMENT_KEY` (or `~raid_enrollment_key`), plus **LAN-reachable** `~raid_enroll_host` / `RAID_ENROLL_HOST` (same address RAID uses to reach robot HTTP, e.g. `GET /health` on x402 REST port).

## Parameters and env table

| Name | Purpose |
|------|---------|
| `~raid_app_url` / `RAID_APP_URL` / base URL | All RAID calls. Priority: non-empty rosparam, else `RAID_APP_URL` from `.env`, else default `http://raid-app.local:3000`. If mDNS fails, set IP in launch or `.env`, e.g. `http://192.168.1.100:3000`. |
| `ROBOT_FLEET_ENROLLMENT_SECRET` / `~robot_fleet_enrollment_secret` | Enroll and other `/api/robots` mutations requiring fleet auth on RAID. |
| `RAID_ENROLLMENT_KEY` / `~raid_enrollment_key` | Stable device key (idempotent enroll). |
| `~raid_enroll_host`, `RAID_ENROLL_HOST` | `host` field in enroll body — not `localhost` if RAID is on another machine. |
| `~raid_enroll_http_port` | Robot HTTP port in enroll body (`port`); default matches x402 REST port from `endpoints` JSON. |
| `~raid_enroll_rosbridge_host`, `~raid_enroll_rosbridge_port` | `rosbridgeHost` / `rosbridgePort` in enroll (default HTTP host, port **9090**). |
| `~raid_robot_name` | Optional `name` in enroll. |
| `RAID_TO_ROBOT_SECRET` / `~raid_to_robot_secret` | Validates inbound `X-Raid-To-Robot-Secret` on sync endpoint. |
| `~raid_operator_sync_path` | POST path on robot REST (default `/raid/operator-allowlist`). Full `operatorRegistryUrl` at enroll: `http://<raid_enroll_host>:<raid_enroll_http_port><path>`. |

Do **not** commit secrets; use `~/.rospy_x402.env`, `ROSPY_X402_ENV_FILE`, or systemd `Environment=`.

**Why no enroll in logs:** `rospy_x402/.env` is gitignored — after `git pull` copy from dev or create from `.env.example`. Install **python3-dotenv** (`sudo apt install python3-dotenv`). The node merges several `.env` sources (package `config/.env`, package `.env`, cwd, `~/.rospy_x402.env`, `ROSPY_X402_ENV_FILE` — last wins). Or `export ROBOT_FLEET_ENROLLMENT_SECRET=...` before `roslaunch` — child inherits.

## `teleop/help` behaviour

Success: HTTP **200** or **201**. **200** with `duplicate: true` — request already open, treated as success. **401** — bad `robotId` / `teleopSecret`, retries useless until config or re-enroll.

Request `metadata` carries `task_id`, `error_context`, and **`situation_report`** (free-text escalation context). RAID contract: [RAID_APP_TELEOP_HELP_SPEC.md](RAID_APP_TELEOP_HELP_SPEC.md).

If **`POST …/teleop/help`** JSON already has **`teleopGrantPayload`** + **`teleopGrantSignature`**, the robot forwards them to KYR. Else, with request **`id`** and **`~raid_session_grant_poll`**, the robot **polls** `GET …/teleop/session-grant?helpRequestId=…` (after operator Accept on RAID). On success — same path into KYR. Else — mock fallback. Step order and RAID errors: [ROBOT_TELEOP_KYR_RAID_GRANT.md](ROBOT_TELEOP_KYR_RAID_GRANT.md). Full cycle: [RAID_APP_TELEOP_HELP_FULL_CYCLE_X402_SPEC.md](RAID_APP_TELEOP_HELP_FULL_CYCLE_X402_SPEC.md).

ROS: service `/x402/request_help` (`rospy_x402/RequestHelp`) — third field `situation_report`.

## Operator payment: session closed but SOL balances unchanged

Chain **`/teleop_fetch/end_session`** → `close_session` → **`/x402/complete_teleop_payment`** may finish **without** an on-chain transfer:

1. **Common cause:** before RAID was updated the robot used a **mock grant** with `operator_pubkey: "pending_from_raid"`. **SignedReceipt** has the same — `pay_operator_from_receipt_payload` **intentionally skips** SOL (invalid address guard). You need RAID **`teleopGrantPayload` / signature** with real operator **Solana base58** ([RAID_APP_TELEOP_HELP_FULL_CYCLE_X402_SPEC.md](RAID_APP_TELEOP_HELP_FULL_CYCLE_X402_SPEC.md)).
2. **Logs:** after teleop_fetch changes, **WARN** `complete_teleop_payment: success but NO on-chain transfer` and in rospy_x402 `Operator payment skipped: receipt has placeholder operator_pubkey`. In `x402_ex_server` logs look for `Sent x402 payment` / RPC errors.
3. **Wallet and RPC:** robot wallet needs **SOL** (amount + fee), `.env` / launch needs working **`SOLANA_PRIVATE_KEY`** and RPC (e.g. Helius).
4. **Manual transfer test** (real operator pubkey, one-line JSON in `receipt_payload`):

```bash
rosservice call /x402/complete_teleop_payment "receipt_payload: '{\"operator_pubkey\":\"<OPERATOR_BASE58>\",\"started_at_sec\":0,\"ended_at_sec\":10}'"
```

With `teleop_operator_payment_flat_sol` set on `x402_server`, a fixed amount is sent regardless of time fields in JSON.

## Inbound WebSocket (rosbridge)

Operator JWT does not reach rosbridge; RAID forwards headers/query with operator UUID. Stock rosbridge does not validate them — see [ROSBRIDGE_AND_RAID.md](ROSBRIDGE_AND_RAID.md) (this bundle; upstream KYR may differ).
