# TASK_ROUTER / RAID_APP developer bundle (SINC)

Copied snapshots for handoff. **Canonical** copies live in the repositories named in **SOURCE** below; refresh this folder before sending if specs changed.

## Contents

| File | SOURCE (repository path) |
|------|---------------------------|
| `RAID_INTEGRATION.md` | `rospy_x402/DOC/` |
| `RAID_APP_TELEOP_HELP_SPEC.md` | `rospy_x402/DOC/` |
| `RAID_APP_TELEOP_HELP_FULL_CYCLE_X402_SPEC.md` | `rospy_x402/DOC/` |
| `ROBOT_TELEOP_KYR_RAID_GRANT.md` | `rospy_x402/DOC/` |
| `PEAQ_RAID_CLAIM.md` | `rospy_x402/DOC/` |
| `X402_PROTOCOL.md` | `rospy_x402/DOC/` |
| `ARCHITECTURE.md` | `rospy_x402/DOC/` |
| `env.example` | `rospy_x402/` (renamed from `.env.example` for packaging) |
| `DATA_NODE_INGEST_AND_EVENTS_SPEC.md` | `br-vr-dev-sinc/DOC/` — §5 batch + §5.2 provisioning |
| `RAID_APP_DATA_NODE_CORRELATION_SPEC.md` | `br-vr-dev-sinc/DOC/` |
| `RAID_APP_PEAQ_CLAIM_SPEC.md` | `br-vr-dev-sinc/DOC/` |
| `DATA_NODE_SYNC.md` | `br-kyr/DOC/` — robot-side settings + RAID `dataNodeSync` |
| `ROSBRIDGE_AND_RAID.md` | `br-kyr/DOC/` |

## External

Extend **`ROBOT_OPERATOR_SYNC.md`** in the RAID / `x402_raid_app` repository for operator-push narrative aligned with `dataNodeSync` (referenced from `RAID_INTEGRATION.md`).
