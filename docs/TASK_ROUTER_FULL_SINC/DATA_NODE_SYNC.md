# KYR — periodic DATA_NODE sync (non-teleop robot events)

**Audience:** KYR / robot operators and integrators.  
**Version:** 2026-04-11.  
**DATA_NODE API contract:** [DATA_NODE_INGEST_AND_EVENTS_SPEC.md](DATA_NODE_INGEST_AND_EVENTS_SPEC.md) §5 (this bundle; upstream `br-vr-dev-sinc` may differ).  
**RAID help fields (not this path):** [RAID_APP_DATA_NODE_CORRELATION_SPEC.md](RAID_APP_DATA_NODE_CORRELATION_SPEC.md) or [../RAID_APP_DATA_NODE_CORRELATION_SPEC.md](../RAID_APP_DATA_NODE_CORRELATION_SPEC.md).

---

## 1. Purpose

Teleop datasets reach DATA_NODE via **`POST /sessions/upload`** when a recording is finalized (see `teleop_fetch`). That path does **not** cover:

- **USB / device list changes** (from `state.json` / `devices_hash`),
- **Verification audit** lines (`audit.jsonl`),
- **Dashboard** JSONL events (`dashboard_events.jsonl`) that are not tied to a dataset upload,
- **KYR incidents** (`incidents.jsonl`) — structured incidents with stable `incident_uid` (see KYR product docs; no `KYR_INCIDENTS.md` in this repo).

The KYR **Black Box** web UI can enable a **background uploader** that every **N seconds** sends new rows to DATA_NODE’s **robot event batch** endpoint, so the fleet database gets a timeline without teleop.

---

## 2. Configuration (web UI + disk)

Settings are stored under **`$KYR_HOME`** (default `~/.kyr`):

| File | Content |
|------|---------|
| `data_node_sync_settings.json` | Operator-editable JSON (see §3). |
| `data_node_sync_cursor.json` | Internal byte offsets and last `devices_hash` (do not hand-edit). |

The Black Box page **DATA_NODE sync** panel loads/saves settings via **`GET/POST /api/data_node_sync`**.

---

## 3. Settings schema (`data_node_sync_settings.json`)

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | bool | `false` | Master switch for the background uploader. |
| `base_url` | string | `""` | DATA_NODE base URL, e.g. `https://data.example.com` (no trailing slash). |
| `batch_path` | string | `"/v1/ingest/robot-events"` | Path appended to `base_url`. |
| `interval_sec` | number | `300` | Minimum seconds between upload attempts. |
| `auth_header_name` | string | `"Authorization"` | HTTP header for auth, if required. |
| `auth_header_value` | string | `""` | Full header value, e.g. `Bearer …` (stored on disk; treat as secret). |
| `include_dashboard_events` | bool | `true` | Upload new lines from `dashboard_events.jsonl`. |
| `include_audit_events` | bool | `true` | Upload new lines from `audit/audit.jsonl`. |
| `include_state_usb_snapshot` | bool | `true` | Emit `usb_devices_changed` when `devices_hash` in `state.json` changes. |
| `include_kyr_incidents` | bool | `true` | Upload new lines from `incidents.jsonl` as batch events with `source: kyr_incident`. |
| `raid_robot_uuid` | string | `""` | Optional RAID enroll robot UUID for the batch envelope. |
| `kyr_robot_id` | string | `""` | Optional override when `state.json` is missing; otherwise taken from `state.json` `robot_id`. |
| `raid_provisioned` | bool | `false` | Set when URL/auth were applied from **RAID** (`dataNodeSync` on enroll or operator-sync POST). UI locks manual fields unless `KYR_DATA_NODE_MANUAL_OVERRIDE=true`. |

**Security:** prefer LAN or TLS to DATA_NODE; restrict who can open the Black Box port.

---

## 4. RAID provisioning (task router)

**Authoritative control:** RAID can supply DATA_NODE batch settings so operators do not paste tokens into the robot UI.

1. **Enroll** — `POST /api/robots/enroll` response may include **`dataNodeSync`** (see [RAID_INTEGRATION.md](RAID_INTEGRATION.md) in this bundle, or the `rospy_x402` repo). `x402_ex_server` merges it into `data_node_sync_settings.json` and sets **`raid_provisioned`: true**.
2. **Push** — Same object may be sent on the existing **`POST {operatorRegistryUrl}`** (operator allowlist endpoint on the robot) together with **`allowedTeleoperatorIds`**, or alone when only DATA_NODE endpoint/token changed.
3. **Updates** — Re-enroll or another push overwrites fields present in the payload. Empty **`authHeaderValue`** omits updating the stored token (keeps previous secret).

---

## 5. Uploader behaviour

1. On an interval, if **`enabled`** and **`base_url`** are set, build a **batch** per [DATA_NODE_INGEST_AND_EVENTS_SPEC.md](DATA_NODE_INGEST_AND_EVENTS_SPEC.md) §5 (same bundle; upstream copy in `br-vr-dev-sinc` if needed).
2. **Dashboard / audit:** read only **appended** bytes since the last successful cursor; each JSON line becomes one `RobotEvent` with deterministic `eventUid` (content hash) for idempotency.
3. **Incidents:** read appended bytes from **`incidents.jsonl`**; each line maps to one event with `source: "kyr_incident"` and **`eventUid` equal to `incident_uid`** (KYR product docs).
4. **State / USB:** compare `devices_hash` in `state.json` to the cursor; on change, send one event with `source: "kyr_state"`, `kind: "usb_devices_changed"`, and a **truncated** `devices` list in `metadata` (cap count and field sizes to keep batches small).
5. On **HTTP success**, advance cursors. On failure, **do not** advance (retry next cycle). Log errors to stderr (Flask / ROS console).
6. Clearing **`dashboard_events.jsonl`** via the UI resets the dashboard cursor on next read if the file shrinks (offset &gt; file size → cursor reset to 0).

---

## 6. Related

- Incidents model: KYR product documentation (`incidents.jsonl`).
- Black Box overview: §2–3 above and the KYR web UI (no bundled `BLACKBOX_DASHBOARD.md` in this repo).
- Dataset push (teleop): `br-vr-dev-sinc` / `teleop_fetch` docs.
