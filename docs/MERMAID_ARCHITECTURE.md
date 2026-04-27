# Robot stack — connections and authentication (reference)

**Temporary handout** under `br_bringup/TEMP/`. Source of truth remains the linked repositories (`br-kyr`, `rospy_x402`, `br-vr-dev-sinc`).

## Mermaid — components and auth

```mermaid
flowchart TB
  subgraph Robot["Robot (ecosystem.launch)"]
    X402["x402_ex_server\n(rospy_x402 REST)"]
    KYR["KYR core / proxy / incidents"]
    BB["kyr_blackbox_server\n(unified web UI)"]
    W["data_node_sync_worker\n(KYR)"]
    TF["teleop_fetch +\ndataset_upload_server"]
  end

  subgraph RAID["TASK_ROUTER / RAID_APP"]
    ENR["POST /api/robots/enroll"]
    HELP["POST /api/robots/{id}/teleop/help"]
    PUSH["Outbound POST\noperatorRegistryUrl"]
  end

  subgraph DN["DATA_NODE"]
    UP["POST /sessions/upload\n(multipart dataset)"]
    BAT["POST …/robot-events\n(batch ingest §5)"]
  end

  subgraph Ops["Operator path"]
    OP["Operator client"]
    RB["rosbridge :9090"]
  end

  DN -. "out-of-band:\nissue batch API creds\nto RAID" .-> RAID

  X402 -->|"enroll body + fleet auth\n(ROBOT_FLEET_ENROLLMENT_SECRET)"| ENR
  ENR -->|"200: id, teleopSecret;\noptional dataNodeSync"| X402

  PUSH -->|"header X-Raid-To-Robot-Secret\n(RAID_TO_ROBOT_SECRET)"| X402
  PUSH -. "JSON: allowedTeleoperatorIds\nand/or dataNodeSync" .-> X402

  X402 -->|"header X-Robot-Teleop-Secret\n(teleopSecret)"| HELP

  W -->|"HTTP header from\n~/.kyr/data_node_sync_settings.json\n(e.g. Authorization)"| BAT
  TF -->|"dataset_data_node_url +\nDATA_NODE auth policy"| UP

  X402 -. "writes\n~/.ros/raid_robot_state.json\n~/.kyr/data_node_sync_settings.json" .-> Robot
  KYR --> W
  BB -->|"GET/POST /api/data_node_sync\n(operator UI)"| KYR

  OP --> RAID
  RAID -->|"proxied WS; operator UUID\nin headers/query"| RB
  RB --> Robot
```

## Legend (short)

| Edge | Meaning |
|------|---------|
| Robot → RAID enroll | One-time or idempotent registration; fleet secret proves robot fleet membership. |
| RAID → Robot push | RAID initiates; shared secret `RAID_TO_ROBOT_SECRET` proves caller is RAID. |
| Robot → RAID `teleop/help` | `teleopSecret` proves this robot instance matches enroll record. |
| Robot → DATA_NODE batch | URL/token normally **provisioned by RAID** into `data_node_sync_settings.json` (`dataNodeSync`). |
| Robot → DATA_NODE upload | Usually **launch/config** (`dataset_data_node_url`); not the same mechanism as batch unless you align them in ops. |
| DATA_NODE → RAID (dashed) | **Product/ops**: DATA_NODE gives RAID ingest credentials; not a single normative HTTP step on the robot. |

## Bundles in this folder

- `DATA_NODE_FULL_SINC/` — specs for DATA_NODE developers (ingest, sessions, HBR, correlation).
- `TASK_ROUTER_FULL_SINC/` — specs for RAID / task-router developers (enroll, push, teleop/help, x402 grant flow, batch provisioning contract).
