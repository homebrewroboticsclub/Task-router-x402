# RAID App — DATA_NODE correlation (`teleop/help` and operator-facing data)

**Audience:** RAID App developers (`x402_raid_app` or equivalent).  
**Version:** 2026-04-10.  
**Does not replace:** base `POST …/teleop/help` contract — [RAID_APP_TELEOP_HELP_SPEC.md](RAID_APP_TELEOP_HELP_SPEC.md) (this bundle) or [../RAID_APP_TELEOP_HELP_SPEC.md](../RAID_APP_TELEOP_HELP_SPEC.md) (canonical in repo).  
**DATA_NODE (storage / joins):** [DATA_NODE_INGEST_AND_EVENTS_SPEC.md](DATA_NODE_INGEST_AND_EVENTS_SPEC.md).

---

## 1. Purpose

When the robot calls **`POST /api/robots/{robotId}/teleop/help`**, RAID should **accept, persist, and expose** optional metadata fields that let **DATA_NODE** later join:

- the help / escalation record,
- the active **dataset** (`dataset_id`) on the robot,
- the **KYR teleop session** (`kyr_session_id`),
- the **KYR robot string id** (`kyr_robot_id`),

without guessing from free text.

This spec is **only** about RAID behaviour. Dataset upload to DATA_NODE remains **robot → DATA_NODE** (see `teleop_fetch` / HBR docs).

---

## 2. Request body (extensions)

The robot may send additional keys inside **`metadata`** (alongside `task_id`, `error_context`, `situation_report`, optional `kyr_peaq_context`):

| Key | Required | Description |
|-----|----------|-------------|
| `dataset_id` | no | Active dataset / record id from `dataset_recorder` when recording overlaps help. |
| `kyr_session_id` | no | KYR `open_session` id when help is requested during teleop. |
| `kyr_robot_id` | no | KYR string id (`kyr_proxy` param `~robot_id`). |

**Rules:**

1. **Forward compatibility:** if a key is missing, do not fail validation.
2. **Unknown keys:** accept and persist optional JSON on the help-request model (or store raw `metadata` blob) so future robot versions do not require RAID redeploy.
3. **Limits:** apply the same UTF-8 / size policy as for `situation_report` where applicable; reject or truncate per product policy.

---

## 3. Persistence and API

1. **Store** the full `metadata` object (or at minimum the keys above) on the help-request / incident model.
2. **Expose** these fields on **operator UI** and **internal API** used by DATA_NODE sync jobs (if any), e.g. when RAID forwards incidents to DATA_NODE or when operators link a help ticket to a dataset card.

Exact RAID→DATA_NODE replication is **optional**; DATA_NODE may also ingest incidents only from the robot (see DATA_NODE spec). If RAID **does** push help rows to DATA_NODE, use the same **semantic field names** as in §2.

---

## 4. Policy: `task_id` vs `dataset_id`

**Recommendation:** when the robot is recording a dataset during teleop, **`metadata.task_id` SHOULD equal `metadata.dataset_id`** so DATA_NODE can correlate help with the teleop session card without heuristics.

If no recording is active, `dataset_id` may be empty and `task_id` may be synthetic.

---

## 5. Related documentation

- [DATA_NODE_INGEST_AND_EVENTS_SPEC.md](DATA_NODE_INGEST_AND_EVENTS_SPEC.md) — DATA_NODE tables, ingest, robot event batch.
- [../DATA_NODE_OPERATOR_SESSION_SPEC.md](../DATA_NODE_OPERATOR_SESSION_SPEC.md) — dataset `metadata.json`, `operatorSessionMeta`.
- Robot-side correlation params and HBR keys: `teleop_fetch`, `rospy_x402` `EscalationManager`, [DATA_NODE_SYNC.md](DATA_NODE_SYNC.md) (this bundle).
