# rospy_x402 Architecture (for developers and agents)

This document describes the current architecture of the `rospy_x402` package so that other developers or AI agents can extend, integrate, or reason about the codebase consistently.

## Overview

- **Purpose**: Expose robot capabilities over REST with pay-per-use enforcement via the x402 protocol (Solana), handle teleoperation escalation to RAID APP, and allow the robot to pay external x402 services (including post-pay for teleoperators based on KYR SignedReceipts).
- **Stack**: ROS 1 (Noetic), Python 3, HTTP server (stdlib), Solana RPC for payment verification and sending.

## Directory layout

```
rospy_x402/
├── config/
│   └── endpoints.example.json   # Endpoint and pricing config
├── DOC/                          # Architecture and protocol docs
├── scripts/
│   └── x402_ex_server.py         # ROS node: REST server + x402_buy_service
├── src/rospy_x402/
│   ├── config.py                 # ServerConfig, EndpointConfig, EndpointPricing, load_config
│   ├── server.py                 # X402RestServer (HTTP + x402 402 handling)
│   ├── health.py                 # get_health_status (used by /health endpoint)
│   ├── raid_integration.py       # RAID enroll, state file, operator allowlist JSON
│   ├── escalation_service.py     # teleop/help to RAID, signed grant parse (raid_teleop_grant), RequestHelp, peaq claim
│   ├── raid_teleop_grant.py      # extract teleopGrantPayload + signature from RAID JSON
│   ├── raid_session_grant_client.py # poll GET …/teleop/session-grant after help (RAID Accept)
│   ├── teleop_operator_payment.py # SOL to operator from KYR receipt (shared with complete_teleop_payment)
│   ├── raid_peaq_client.py       # HTTP GET peaq claim from RAID (see DOC/PEAQ_RAID_CLAIM.md)
│   ├── demo_actions.py           # Demo callables (move_demo, buy_cola_demo, shoot_demo)
│   ├── bazaar_cli.py             # Console CLI for x402 Bazaar (search/configure)
│   └── x402/                     # Reusable x402/Solana library
│       ├── client.py             # X402Client (sessions, verify_payment, send_payment)
│       ├── models.py             # PaymentRequest, PaymentSession
│       ├── schema.py             # x402 V2 response/discovery helpers
│       ├── key_manager.py        # KeyMaterial load from prompt
│       ├── solana_rpc.py         # SolanaRpcClient (getSignaturesForAddress, getTransaction)
│       ├── transaction_sender.py # SolanaTransactionSender (transfer)
│       ├── encoding.py           # (if any)
│       └── exceptions.py         # X402Error, PaymentVerificationError, etc.
├── srv/
│   └── x402_buy_service.srv      # ROS service definition
├── package.xml, setup.py, CMakeLists.txt
└── README.md
```

## Components

### 1. Configuration (`config.py`)

- **ServerConfig**: `listen_host`, `listen_port`, `require_https`, `facilitator_url`, `base_url`, `x402_network`, `endpoints`.
- **EndpointConfig** (per route): `path`, `http_method`, `description`, `ros_action` (module/callable/args/kwargs), `x402_pricing` (optional), `metadata` (e.g. `requestSchema` for Bazaar).
- **EndpointPricing**: `amount`, `asset_symbol`, `receiver_account`, `payment_window_sec`.
- Config is loaded from a single JSON file (e.g. `endpoints.example.json`). `base_url` and `x402_network` are used for x402 V2 discovery and 402 responses.

### 2. REST server (`server.py`)

- **X402RestServer**: Holds `ServerConfig`, `X402Client`, and an in-process `ThreadingHTTPServer`.
- **Routes**: Built from config; each `(path, method)` maps to one `EndpointConfig`.
- **Special route**: `GET /.well-known/x402` serves the x402 V2 discovery document (all endpoints as resources with `accepts` for paid ones).
- **RAID operator sync** (optional): If `raid_to_robot_secret` is set on the server instance, `POST` on `raid_operator_sync_path` validates `X-Raid-To-Robot-Secret` and writes `allowedTeleoperatorIds` via `raid_integration.save_operator_allowlist` (handled before the config endpoint map).
- **Request flow**: Parse body → resolve endpoint → compute `base_url` (config or `Host` header) → `_process_endpoint_request(endpoint, body, headers, base_url)`.
- **Payment enforcement**: For endpoints with `x402_pricing`, `_ensure_payment` checks for `X-X402-Reference` (or body `x402_reference`). If missing or invalid session, it creates a payment session and raises `PaymentVerificationError` with a **x402 V2** JSON body (`x402Version: 2`, `accepts[]`, optional `resource`, `extensions.bazaar`). If session exists, it calls `X402Client.verify_payment(reference)` then proceeds.
- **Action invocation**: After payment, the handler invokes the Python callable from `ros_action` (module/callable) with optional `body`; response is `{"status": "ok", "data": result}`.

### 3. x402 library (`x402/`)

- **X402Client**: In-memory payment sessions keyed by `reference`; `create_payment_session(request, ttl_sec)`, `get_session(reference)`, `verify_payment(reference)` (on-chain check), `send_payment(destination, amount_sol)` (outgoing).
- **Payment verification**: Uses `SolanaRpcClient.get_signatures_for_address(receiver)` then for each signature `get_transaction(signature)` with `encoding: jsonParsed`, inspects `transaction.message.instructions` for `type == "transfer"`, `info.destination == receiver`, `info.lamports >= expected`; no off-chain facilitator required by default.
- **schema.py**: Helpers for x402 V2: `build_accepts_entry`, `build_402_response_v2`, `build_resource_entry`, `build_bazaar_extension`, CAIP-2 network constants for Solana.

### 4. ROS node (`scripts/x402_ex_server.py`)

- Resolves RAID credentials: rosparam/env → state file `~/.ros/raid_robot_state.json` → optional auto-enroll (`raid_integration.enroll_robot`). Configures operator-sync route on `X402RestServer` when `RAID_TO_ROBOT_SECRET` is set.
- Loads config and Solana key (prompt), creates `X402RestServer` and starts it in a daemon thread.
- Advertises `x402_buy_service`: request fields include `endpoint`, `method`, `payload`, `headers_json`, `amount`, `asset_symbol`, `payer_account`. If `payer_account` is set, the node **sends** payment to that address, then calls `endpoint` **only if** `endpoint` is non-empty (otherwise transfer-only). If `payer_account` is empty, the node **creates an incoming payment session** and waits for the caller to pay the robot, then proceeds.
- Advertises `/x402/complete_teleop_payment`: after KYR `close_session`, `teleop_fetch` passes `receipt_payload`; the node pays `operator_pubkey` in SOL using `teleop_operator_payment.py` and `X402Client.send_payment` (same wallet as outgoing `x402_buy_service`). Rate: rosparam `~teleop_operator_payment_sol_per_sec`. `send_payment` coerces solana-py’s transaction `Signature` (and any non-`str` RPC result) to an ASCII `str` so the service response field `payment_signature` satisfies ROS genpy serialization.

### 5. Bazaar CLI (`bazaar_cli.py`)

- Console entry point: `x402-bazaar` (or `python -m rospy_x402.bazaar_cli`).
- **search**: Lists resources from a discovery API (default: CDP Coinbase x402 discovery).
- **show \<url\>**: Probes URL and prints 402 V2 payload if present.
- **configure \<url\>**: Fetches 402, outputs a config snippet and a `rosservice call /x402_buy_service` example for the robot to pay that service.

## Data flow summary

- **Incoming paid REST**: Client → GET/POST endpoint → 402 with V2 body → client pays to `accepts[0].payTo`, retries with `X-X402-Reference: accepts[0].extra.reference` → server verifies on-chain → executes action → 200 + JSON.
- **Outgoing (robot pays)**: Caller invokes `x402_buy_service` with `payer_account` set → node sends Solana transfer → if `endpoint` is set, HTTP request with signature header; if `endpoint` is empty, transfer-only success.
- **Teleop operator pay**: `teleop_fetch` → `/x402/complete_teleop_payment` after session close; see [RAID_APP_TELEOP_HELP_FULL_CYCLE_X402_SPEC.md](RAID_APP_TELEOP_HELP_FULL_CYCLE_X402_SPEC.md).
- **Discovery**: GET `/.well-known/x402` → JSON with `x402Version: 2` and `resources[]` (url, description, mimeType, accepts, extensions).

## Extension points

- Add new endpoints in the JSON config (path, method, ros_action, x402_pricing, metadata).
- Implement new callables in `demo_actions` or other modules and reference them in config.
- Use `X402Client` and `schema` helpers from non-ROS code.
- Point `--api-url` in Bazaar CLI to a custom discovery API.

## Peaq claim (RAID, optional)

- **EscalationManager** calls `/kyr/get_peaq_issuance_metadata` and embeds the result in `POST …/teleop/help` as `metadata.kyr_peaq_context`. After a successful help response, it reads inline `peaq_claim` or polls `GET /api/robots/{robotId}/peaq/claim`, then calls `/teleop_fetch/set_peaq_dataset_claim`. See [PEAQ_RAID_CLAIM.md](PEAQ_RAID_CLAIM.md) and `br-vr-dev-sinc/DOC/RAID_APP_PEAQ_CLAIM_SPEC.md`.
- If RAID/Peaq never supplies a claim object (e.g. long-lived `claim_not_ready`), **help and grant forwarding still succeed** (fail-open); dataset export may omit `peaqClaim` until issuance works upstream.

All user-facing strings, logs, comments, and documentation are in English.
