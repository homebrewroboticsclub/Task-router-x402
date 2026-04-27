# DATA NODE: operator session metadata and upload multipart

**Index:** [README.md](../README.md#documentation-index) — this document describes an **adjacent** ingest pipeline, not the Task-router-x402 HTTP API surface.

**Audience:** developers of DATA_NODE (ingest from robot).  
**Version:** 2026-03-29 — extended teleop session fields (`acceptedAtUtcIso`, `teleopControl`, multipart `operatorSessionMeta`).  
**Robot implementation:** `br-vr-dev-sinc` (`upload_models.py`, `episode_recorder.py`, `dataset_upload_server.py`).

---

## 1. Source of truth vs convenience copy

After the robot applies `POST /upload_dataset`, session fields are written to:

```text
<datasetId>.hbr/metadata.json
```

inside the `.tar.gz` produced for `POST /sessions/upload`.

The multipart part **`operatorSessionMeta`** duplicates a subset of those fields so DATA_NODE can index a session **before** unpacking the archive. If values disagree, treat **`metadata.json` inside the archive** as authoritative.

---

## 2. Quest / client JSON: `POST /upload_dataset` (robot port 9191 or Task Router dataset proxy)

Optional top-level fields (backward compatible with clients that omit them):

| Field | Type | Description |
|-------|------|-------------|
| `acceptedAtUtcIso` | string | ISO-8601 UTC — when the VR app accepted the teleop session. |
| `teleopControl` | object | Control handover timeline; see below. |

Existing required shape (unchanged): `source`, `generatedUtcIso`, `records[]` with `recordId`, `label`, `taskName`, `data` including `data.frames` (array).

### 2.1 `teleopControl`

```json
{
  "events": [
    {
      "eventType": "get_control",
      "timestampUtcIso": "2026-03-29T18:00:10.000Z"
    },
    {
      "eventType": "lost_control",
      "timestampUtcIso": "2026-03-29T18:00:25.000Z"
    }
  ]
}
```

- `events` — array; may be empty. Each element must be an object with non-empty string `eventType` and `timestampUtcIso`.
- Expected `eventType` values from Quest include `get_control` and `lost_control`; the robot does not reject other strings (forward compatibility).
- The object may carry additional keys in the future; parsers should tolerate unknown properties inside `teleopControl`.

### 2.2 Full example (minimal records)

```json
{
  "source": "unity_quest_dataset",
  "generatedUtcIso": "2026-03-29T18:10:00.000Z",
  "acceptedAtUtcIso": "2026-03-29T18:00:00.000Z",
  "records": [
    {
      "label": "record_1",
      "taskName": "task_alpha",
      "data": {},
      "recordId": "abc123"
    }
  ],
  "teleopControl": {
    "events": [
      {
        "eventType": "get_control",
        "timestampUtcIso": "2026-03-29T18:00:10.000Z"
      },
      {
        "eventType": "lost_control",
        "timestampUtcIso": "2026-03-29T18:00:25.000Z"
      }
    ]
  }
}
```

Note: real uploads must include a proper `data` object with a `frames` array (possibly empty) for robot validation; the snippet above is illustrative for session metadata only.

---

## 3. `metadata.json` inside `.hbr`

After the recorder merges operator upload data, `metadata.json` may include:

| Key | Description |
|-----|-------------|
| `acceptedAtUtcIso` | Present when the upload payload carried a non-empty value. |
| `teleopControl` | Full object from the upload (including `events`). Omitted if the upload had no `teleopControl`. |
| `generatedUtcIso` | From upload payload (existing). |
| `source` | From upload payload (existing). |

The operator event log `operator/events.jsonl` gains an `upload_received` entry that may include `acceptedAtUtcIso` and `teleopControl` for traceability; the canonical control timeline for analytics is `metadata.json.teleopControl`.

---

## 4. `POST /sessions/upload` multipart (robot → DATA_NODE)

Existing parts (unchanged):

- `datasetId` — text
- `taskName` — text
- `label` — text
- `file` — gzip tar archive (`<datasetId>.hbr.tar.gz`)

**New optional part:**

- **Name:** `operatorSessionMeta`  
- **Content-Type:** `application/json`  
- **Body:** UTF-8 JSON object, built only from keys that exist and are non-empty in `metadata.json` at push time:

| Key | Included when |
|-----|----------------|
| `source` | non-empty string |
| `generatedUtcIso` | non-empty string |
| `acceptedAtUtcIso` | non-empty string |
| `teleopControl` | value is a JSON object (may be empty `{}`) |

If none of these are set, the **`operatorSessionMeta` part is omitted** entirely (older robots / datasets).

### 4.1 Parsing guidance

1. If `operatorSessionMeta` is absent, read session fields only from the unpacked `metadata.json`.
2. If present, parse JSON once; use for indexing or UI; reconcile with `metadata.json` after extraction if both exist.

---

## 5. Related docs

- [TELEOP_DATAS.md](TELEOP_DATAS.md) — full headset upload contract and frames.
- [HBR.md](HBR.md) — `.hbr` layout.
- [RAID_APP_DATASET_PROXY_SPEC.md](RAID_APP_DATASET_PROXY_SPEC.md) — HTTPS proxy to the same upload API (transparent body).
