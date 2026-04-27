# RAID App: HTTP reverse proxy for robot dataset API

**Audience:** developers of **Task-router-x402** (`task-router-x402`, Node.js).  
**Purpose:** teleoperators reach the robot’s existing dataset REST server **only through RAID** (HTTPS, JWT). The robot implementation lives in `br-vr-dev-sinc` (`dataset_upload_server.py`); **do not duplicate** request/response schemas on RAID—**transparently proxy** HTTP.

**Robot-side reference:** `dataset_upload_server.py` in the `br-vr-dev-sinc` repository (not vendored in this repo).

---

## 1. Problem

- Operators connect via RAID (WebSocket teleop, JWT).
- The robot exposes dataset HTTP on **port 9191** (LAN). Remote operators **cannot** call `http://<robot>:9191/...` directly.
- **DATA_NODE** upload from the robot (`dataset_recorder` → `POST /sessions/upload`) is unchanged and stays robot → DATA_NODE on LAN.

---

## 2. Canonical public URL (RAID)

All operator dataset HTTP traffic:

```text
https://<raid-host>/api/teleop/robots/<robotId>/dataset/<rest>
```

- `<robotId>`: UUID of the robot in the RAID registry (same as in enroll / help URLs).
- `<rest>`: **exact** path and query string as on the robot, relative to the dataset server root (default port **9191**).

### Upstream mapping

For each incoming request:

```text
METHOD https://<raid>/api/teleop/robots/{robotId}/dataset/{rest}
  →  METHOD http://{upstreamHost}:{upstreamPort}/{rest}
```

Examples:

| Client calls (RAID) | Proxied to (robot) |
|---------------------|---------------------|
| `POST .../dataset/upload_dataset` | `POST http://{host}:9191/upload_dataset` |
| `GET .../dataset/dataset_status` | `GET http://{host}:9191/dataset_status` |
| `GET .../dataset/dataset_logs?lines=100` | `GET http://{host}:9191/dataset_logs?lines=100` |
| `GET .../dataset/dataset_download/{datasetId}` | `GET http://{host}:9191/dataset_download/{datasetId}` |
| `POST .../dataset/dataset_delete` | `POST http://{host}:9191/dataset_delete` |
| `POST .../dataset/dataset_push` | `POST http://{host}:9191/dataset_push` |
| `POST .../dataset/dataset_clear_all` | `POST http://{host}:9191/dataset_clear_all` |

If the robot changes `upload_api.path` in YAML (default `/upload_dataset`), the client path under `/dataset/` must match—RAID does not rewrite path names beyond stripping the prefix.

---

## 3. Endpoints on the robot (must all be proxied)

Implemented in `dataset_upload_server.py` (default listen `0.0.0.0:9191`):

| Method | Path | Notes |
|--------|------|--------|
| GET | `/dataset_status` | JSON status |
| GET | `/dataset_logs` | Query `lines` optional |
| GET | `/dataset_download/{datasetId}` | May stream/archive |
| POST | `/dataset_delete` | JSON body |
| POST | `/dataset_push` | JSON body |
| POST | `/dataset_clear_all` | JSON body |
| POST | `/upload_dataset` | Default; configurable via ROS param `~upload_api/path` |

CORS on robot: `Access-Control-Allow-Origin: *` for simple cases; if the browser talks **only** to RAID, CORS must be correct **on RAID** for the operator origin.

---

## 4. Authentication and authorization (RAID)

1. **JWT:** Validate teleoperator session (same as teleop UI / API).
2. **Grant:** Operator must be allowed to act on `robotId` (same rule as accepting teleop help—`teleoperator_robot_grants` / “any if no grants” policy).
3. On success, forward the request upstream. Optionally add:
   - `X-Forwarded-For`, `X-Forwarded-Proto`
   - `X-Teleoperator-Id` (UUID, same as `sub` in JWT) for robot-side logs (robot does not verify today).

---

## 5. Upstream host and port

RAID must resolve LAN-reachable coordinates for the dataset HTTP server:

- **Preferred:** explicit registry fields, e.g. `datasetHttpHost`, `datasetHttpPort` (default **9191**), set at enroll or admin UI.
- **Fallback:** `host` from robot enroll card + fixed port **9191** (if dataset always co-located with advertised HTTP host).

RAID must be able to open a TCP connection from its deployment network to `{host}:{port}` (firewall on robot may allow only RAID IP).

---

## 6. Proxy behavior

- Preserve **method**, **path** (after prefix strip), **query string**.
- Forward headers: at minimum `Content-Type`, `Content-Length`; forward `Authorization` only if needed (usually **not** the operator JWT to the robot—robot does not expect it).
- Request/response **bodies:** support large JSON (`POST /upload_dataset`) and streaming for `GET /dataset_download/...`.
- **Timeouts:** significantly higher than default (e.g. 60s–300s) for upload/download.
- **Errors:** map upstream connection errors to `502`/`504`; pass through upstream status codes when possible.

---

## 7. Example: curl (operator)

After login, obtain teleoperator JWT `TOKEN` and robot UUID `ROBOT_ID`:

```bash
curl -sS -X POST \
  "https://<raid-host>/api/teleop/robots/${ROBOT_ID}/dataset/upload_dataset" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"source":"test","records":[]}'
```

```bash
curl -sS \
  "https://<raid-host>/api/teleop/robots/${ROBOT_ID}/dataset/dataset_status" \
  -H "Authorization: Bearer ${TOKEN}"
```

---

## 8. Client configuration (Quest / web)

Base URL template for dataset HTTP when using RAID:

```text
https://<raid-host>/api/teleop/robots/<robotId>/dataset
```

Append path segments: `upload_dataset`, `dataset_status`, etc. Replace `<raid-host>` and `<robotId>` at runtime (robot UUID from RAID session/registry).

Direct `http://<robot-ip>:9191` remains valid **only** on LAN (e.g. lab without RAID path).

---

## 9. Out of scope for RAID proxy

- **DATA_NODE** `POST /sessions/upload` (robot → DATA_NODE, multipart)—not operator-facing through this route.
- **rosbridge** WebSocket—unchanged.
- Changing JSON schemas of `/upload_dataset`—remains entirely on the robot.

---

## 10. Suggested RAID implementation checklist

- [x] Route registration: `/api/teleop/robots/:robotId/dataset/*`
- [x] JWT + grant middleware
- [x] Resolve `upstreamHost` / `upstreamPort` from robot registry (`datasetHttpHost` / `datasetHttpPort`, fallback `host` / **9191**)
- [x] HTTP proxy (streaming) with increased timeouts (`TELEOP_DATASET_PROXY_TIMEOUT_MS`, default 300000)
- [x] CORS for operator web clients if needed (global CORS already reflects `Origin`; Bearer JWT does not need cookie preflight quirks)
- [x] Integration tests against a mock upstream (`test/teleop-dataset-proxy-http.test.js`)
- [x] Document in RAID README / OpenAPI
