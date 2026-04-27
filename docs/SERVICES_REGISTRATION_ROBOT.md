# Services registration — guidance for robot stack developers

This note is for teams maintaining the **robot** HTTP API (KYR / `rospy_x402` operator registry, etc.). It aligns with [ROBOT_OPERATOR_SYNC.md](ROBOT_OPERATOR_SYNC.md) and [TASK_ROUTER_FULL_SINC/RAID_INTEGRATION.md](TASK_ROUTER_FULL_SINC/RAID_INTEGRATION.md).

## Mutual registration model

| Direction | Mechanism | Secret / header |
|-----------|-----------|------------------|
| Robot → RAID | `POST /api/robots/enroll` (fleet) or admin-registered robot | `ROBOT_FLEET_ENROLLMENT_SECRET` as `Authorization: Bearer …` or `X-Robot-Fleet-Secret` |
| RAID → robot | `POST {operatorRegistryUrl}` (allowlist + optional `dataNodeSync`) | `X-Raid-To-Robot-Secret` (= `RAID_TO_ROBOT_SECRET` on RAID, or stored in RAID `services-registration.json`) |
| Robot → DATA_NODE | Background batch uploader | Values from `dataNodeSync` merged on disk (`~/.kyr/data_node_sync_settings.json` per KYR docs) |

RAID may store **fleet enrollment** and **RAID→robot** secrets in **Admin → Services registration** (`/ui/services-registration.html`), which writes `config/services-registration.json` (gitignored). Environment variables still take precedence where documented in RAID.

## Operator registry endpoint (`operatorRegistryUrl`)

- **Method:** `POST`
- **Header:** `X-Raid-To-Robot-Secret` must match the value configured on RAID.
- **Body:** JSON object with at least one of:
  - `allowedTeleoperatorIds` — string array (teleoperator UUIDs),
  - `dataNodeSync` — object merged into robot DATA_NODE batch settings.

RAID’s **Run robot registry test** (Services registration page) sends **`POST` with an empty JSON object** `{}` and the secret header. Expect **4xx** if your API validates required fields; that is still useful as a **reachability + secret** check. Prefer returning a clear JSON error (e.g. “expected allowedTeleoperatorIds or dataNodeSync”) so operators can tell “wrong secret” vs “wrong URL”.

## Mirror UI on the robot (recommended)

Add a **Services registration** page in the robot admin / Black Box UI that:

1. **Displays** the configured `operatorRegistryUrl` and whether `X-Raid-To-Robot-Secret` is set (never echo the full secret; mask or show “configured”).
2. **Shows** merged `dataNodeSync` (base URL, batch path, header name; mask token).
3. **Allows pasting** a new ingest token or URL when `KYR_DATA_NODE_MANUAL_OVERRIDE` (or your policy) permits.
4. **Runs a local test:** either call your own registry handler with a dummy body or perform an outbound probe to RAID (`GET /health`) using the registered host — product choice.

The RAID app already provides the same class of tools on **its** side; the robot UI should focus on **what the device stores** and **whether pushes from RAID succeeded** (last sync time, last error).

## Enrollment and re-push

- New robots receive `dataNodeSync` in the **enroll response** when RAID has fleet (or per-robot override) provisioning configured.
- Existing robots: operator triggers **Teleop access → Push to robot** or equivalent `POST /api/admin/robots/{id}/sync-operator-allowlist` on RAID.

## Related specs

- [TASK_ROUTER_FULL_SINC/DATA_NODE_SYNC.md](TASK_ROUTER_FULL_SINC/DATA_NODE_SYNC.md) — robot-side `dataNodeSync` fields and worker behaviour.
