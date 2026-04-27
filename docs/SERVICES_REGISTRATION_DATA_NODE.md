# Services registration — guidance for DATA_NODE developers

This note complements [DATA_NODE_INGEST_AND_EVENTS_SPEC.md](TASK_ROUTER_FULL_SINC/DATA_NODE_INGEST_AND_EVENTS_SPEC.md) §5 (robot event batch) and §5.2 (auth provisioning). It describes how the **Task Router (RAID) app** stores DATA_NODE credentials and how operators verify connectivity from the RAID admin UI.

## What RAID stores

- **Fleet batch endpoint** — `baseUrl` + `batchPath` (default `/v1/ingest/robot-events`), optional **auth header** name/value, interval and include flags. These are merged with environment variables (`DATA_NODE_SYNC_*`) and/or the gitignored file `config/services-registration.json` written by the admin UI **Services registration** (`/ui/services-registration.html`).
- RAID does **not** replace your product’s token-issuance API; operations still issue credentials out-of-band (or via your admin API). RAID only **persists** what operators paste and **pushes** the resulting `dataNodeSync` object to robots (enroll + `sync-operator-allowlist`).

## Optional RAID → DATA_NODE path (help / incidents)

If the operator configures **DATA_NODE_INCIDENT_RELAY_*** env vars and/or the relay section in Services registration, RAID may POST a small JSON envelope when a teleop help request is created. That path is separate from the robot batch uploader; auth model should match your ingest policy.

## Connectivity test from RAID UI

The admin action **Run DATA_NODE test** sends **POST** `{baseUrl}{batchPath}` with **Content-Type: application/json** and the configured auth header. Body is a **minimal normative batch** per §5 (schemaVersion, `batchId`, `sentAtUtc`, one `events[]` row with a fresh `eventUid`, `source: "kyr_dashboard"`, `kind: "session_open"`, probe metadata).

**Interpretation for your service**

- **2xx** — request reached your stack and was accepted (or your API treats probes as no-ops with success).
- **401 / 403** — URL reachable; credentials or policy wrong.
- **400 / 422** — often schema validation; still proves TLS/TCP and routing; tighten messages if you want operators to self-serve.
- **Network / 5xx** — mis-typed URL, firewall, or server error.

Idempotency: use **`eventUid`** as you would for robot batches; probes use new UUIDs each run.

## What to implement on DATA_NODE (product)

1. **Document** the batch URL, allowed auth schemes, and response shape (`accepted` / `duplicates` or your equivalent).
2. **Issue** ingest tokens to fleet operators (RAID stores them; robots receive them via `dataNodeSync`).
3. **Optional:** expose a small **health** or **ping** route for lighter checks; RAID’s built-in test uses the real batch path so it validates auth end-to-end.

## Related RAID docs

- [ROBOT_OPERATOR_SYNC.md](ROBOT_OPERATOR_SYNC.md) — push of `dataNodeSync` to the robot.
- [TASK_ROUTER_FULL_SINC/DATA_NODE_SYNC.md](TASK_ROUTER_FULL_SINC/DATA_NODE_SYNC.md) — robot-side persistence of `dataNodeSync`.

## Mirror UI on DATA_NODE (your product)

If you add a **Services registration** page on the DATA_NODE operator UI, it should let admins **view/copy** ingest URLs and tokens they give to RAID, **rotate** tokens, and **run a self-test** (POST the same envelope to your own endpoint). RAID remains the system that **pushes** `dataNodeSync` to robots; DATA_NODE UI is authoritative for **what token** RAID should paste, not for pushing to robots.
