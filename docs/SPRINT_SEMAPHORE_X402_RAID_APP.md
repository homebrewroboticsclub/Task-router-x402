# Sprint deliverables vs **task-router-x402** repository

**Date:** 2026-03-31  
**Repository:** Node.js + Express (`src/`), static `public/`, PostgreSQL when `DATABASE_URL` is set.  
**Product role:** Task Router orchestrator — x402, robot registry, teleop help, SessionGrant signing for KYR, ROSBridge/WebSocket proxy, HTTP dataset proxy, optional Peaq `did.read` for help-request claims.

This service is **not** a full “DATA node” with sprint incident/session domain (`/api/v1/receipts`, `/api/v1/incidents`, `SessionRecord` as in KYR stats, recovery slices, HuggingFace, etc.). Below, each item notes whether it belongs to **this** repo and how it maps to code and tests.

### Status legend (“In repo” column)

| Status | Meaning |
|--------|---------|
| **N/A** | Out of scope for this repository (another service, ROS, VR, Ops/CEO). |
| **Partial** | Related groundwork or adjacent feature (docs, `task_id` in payload, Peaq claim JSON), but the sprint criterion is not fully met here. |
| **Yes** | Implemented here; covered by tests where `package.json` includes matching files. |

### Environment check (when this doc was prepared)

- **`npm test`** — passed (all non-skipped tests). Some integration suites skip without **`TEST_DATABASE_URL`** (see README).
- **Production DB and logs** were not exported: no `help_requests` row counts / external incident counts (this service has no sprint incident/receipt tables).

---

## Deliverables (1–24)

| # | Deliverable | In repo | Notes |
|---|-------------|---------|-------|
| 1 | Receipt emission (`receipts`, HMAC, `GET /api/v1/receipts/{id}`) | **N/A** | No `receipts` table or `/api/v1/receipts`. **SignedReceipt** chain for robot/KYR is described in [RAID_APP_TELEOP_HELP_FULL_CYCLE_X402_SPEC.md](RAID_APP_TELEOP_HELP_FULL_CYCLE_X402_SPEC.md); sprint receipt HTTP API is not here. |
| 2 | Receipt–incident link | **N/A** | No `/api/v1/incidents`, no receipt↔incident in DB. |
| 3 | Event↔recording (`dataset_id`, `critical_event_ids`) | **N/A** | Dataset proxy `GET/POST /api/teleop/robots/{id}/dataset/...` exists; sprint session/incident fields live elsewhere. |
| 4 | TELEOP_TAKEOVER auto-detection | **N/A** | ROS / kinematics; Task Router does not emit TELEOP_TAKEOVER to sprint API. |
| 5 | Incident auto-generation | **N/A** | No incident service. |
| 6 | RTT preflight ≥200 ms | **N/A** | VR client; no RTT gate in Task Router before session. |
| 7 | `raid_task_id` + `payment_id` in metadata.json / SessionRecord | **Partial** | SessionGrant **`task_id`** comes from help **`metadata.task_id`** (`teleopHelp.js` accept + `teleopSessionGrantService`). No **`raid_task_id` / `payment_id`** columns on `teleop_sessions`; teleop x402 payment linkage is not modeled as in the sprint. |
| 8 | KYR stats + UI (`total_recordings`, …) | **N/A** | No `GET /api/robots/{id}/stats` or KYR metrics UI. |
| 9 | Teleop-ready pose / TELEOP_READY | **N/A** | ROS / kinematics. |
| 10 | Bilateral control confirm | **N/A** | VR + ROS; no `teleop_ready_at` / `operator_confirmed_at` in API. |
| 11 | Pre-connect briefing card | **N/A** | VR/frontend card; Task Router passes context in **`payload.metadata`** (`situation_report`, `task_id`, …) — [VR_TELEOP_HELP_CLIENT.md](VR_TELEOP_HELP_CLIENT.md), not the sprint “briefing card”. |
| 12 | Manual annotation baseline corpus | **N/A** | Ops / CEO / other backend. |
| 13 | Cosmos Reason (`visual_annotation`, …) | **N/A** | Not implemented. |
| 14 | Recovery slice extractor | **N/A** | Not implemented. |
| 15 | Quality score v2 | **N/A** | Not implemented. |
| 16 | HuggingFace publish pipeline | **N/A** | Not implemented. |
| 17 | Peaq ClaimRegistry, `claim_id` in SessionRecord/incidents | **Partial** | **Peaq SDK `did.read`**, **`peaq_claim`** JSONB on **`help_requests`**, `GET /api/robots/{id}/peaq/claim`, read-failure fallback ([RAID_APP_PEAQ_CLAIM_SPEC.md](RAID_APP_PEAQ_CLAIM_SPEC.md)). No **`claim_id`** on session/incident schema; not the same as “ClaimRegistry real calls + claim_id in SessionRecord”. |
| 18 | GR00T N1.6 validation report | **N/A** | ROS / backend outside this repo. |
| 19 | Annotation QA report | **N/A** | Not implemented. |
| 20 | 500+ external incidents in DB | **N/A** | No external incidents table. |
| 21 | CEO: sessions, task types, ground_truth, demo | **N/A** | Ops/product track; metrics not in this API. |

---

## Sprint tests (1–24) ↔ this repository

| # | Sprint test | Assessment for **task-router-x402** | Coverage in repo |
|---|-------------|-----------------------------------|------------------|
| 1 | Receipt emission | **N/A** — no `GET /receipts` | — |
| 2 | Receipt–incident link | **N/A** | — |
| 3 | Event↔recording link | **N/A** | Dataset proxy: `test/teleop-dataset-proxy-http.test.js` (with `TEST_DATABASE_URL`). |
| 4 | TELEOP_TAKEOVER auto | **N/A** | — |
| 5 | Auto incident | **N/A** | — |
| 6 | RTT preflight | **N/A** | — |
| 7 | `raid_task_id` / `payment_id` in session | **Partial / fails sprint criterion** | `task_id` in signed grant from `metadata.task_id` indirectly (`teleop-session-grant-service.test.js`, `teleop-help-http.test.js` with DB). **`payment_id` on session row** — no. |
| 8 | KYR stats API + UI | **N/A** | — |
| 9 | Safe handoff TELEOP_READY | **N/A** | — |
| 10 | Bilateral confirm timestamps | **N/A** | — |
| 11 | Pre-connect briefing card | **N/A** | Useful data: help payload normalization `test/teleop-help-payload.test.js`. |
| 12 | Manual baseline corpus | **N/A** | — |
| 13 | Cosmos Reason | **N/A** | — |
| 14 | Recovery slice | **N/A** | — |
| 15 | Quality score v2 | **N/A** | — |
| 16–17 | HF publish | **N/A** | — |
| 18 | Peaq ClaimRegistry + `claim_id` in session/incident | **Partial** | `test/peaq-claim-service.test.js` — fallback claim; HTTP/OpenAPI — `openapi-servers.test.js`, `teleop-help-http.test.js` (with DB). No **`claim_id`** on `teleop_sessions`. |
| 19 | Booster spike | **N/A** | Hardware/pipeline outside narrow Task Router API. |
| 20 | GR00T validation | **N/A** | — |
| 21 | Annotation QA | **N/A** | — |
| 22 | External incident DB | **N/A** | — |
| 23 | Session volume / stats | **N/A** | No `GET /api/v1/stats` in this app. |
| 24 | Demo video | **N/A** | — |

---

## What this repo does well relative to adjacent sprint themes

- **KYR × Task Router:** SessionGrant signature (Ed25519), issue after accept, `teleopGrantPollUrl`, columns `teleop_grant_payload` / `teleop_grant_signature`, public key on `/health` — [ROBOT_TELEOP_KYR_RAID_GRANT.md](ROBOT_TELEOP_KYR_RAID_GRANT.md), tests `teleop-session-grant-service.test.js`, `teleop-help-http.test.js`.
- **Teleop pipeline:** requests, accept, sessions, WebSocket, per-robot grants, dataset proxy — tests with `TEST_DATABASE_URL`.
- **Peaq:** optional claim and resilience to `did.read` failure — `peaqClaimService`, spec and tests.
- **OpenAPI inventory:** `test/sprint-inventory-openapi.test.js` asserts absence of sprint paths **`/api/v1/receipts*`**, **`/api/v1/incidents*`**, and **`GET …/robots/{robotId}/stats`** in the built spec (clarifies service boundaries).

---

## Handoff recommendation Sprint 2 → Sprint 3

Criteria in your “HANDOFF REQUIREMENTS” block (receipt chain, safe handoff, baseline corpus, recovery slices, GR00T validation, landings, WTP) **mostly cannot be verified from this repo alone**. For an honest green check you need:

1. A separate service/repo with **`/api/v1/receipts`**, **`/api/v1/incidents`**, `SessionRecord`, stats — own tests and DB.  
2. ROS/VR repos — TELEOP_TAKEOVER, RTT, TELEOP_READY, bilateral confirm, briefing UI.  
3. **task-router-x402** as the **Task Router node** (grants, teleop, x402, Peaq claim when needed), not the single source of truth for deliverables 1–22.

---

## “Traffic light” summary for **task-router-x402** only

| Category | Result |
|----------|--------|
| Fully in repo and close to sprint | SessionGrant signing, teleop help/accept/WS, dataset proxy, Peaq claim on help request. |
| Partial overlap | `task_id` in grant from metadata; Peaq document without separate `claim_id` on session. |
| Outside repo | Receipts/incidents v1, events, RTT, sprint UI cards, HF, quality score, external incidents, CEO metrics, GR00T/annotation QA. |

Update this document when new `/api/v1/*` routes or schema fields appear — cross-check with `npm test` and `/docs-json`.
