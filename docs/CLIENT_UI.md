# Client UI for Task-router-x402

**Index:** [README.md](../README.md#documentation-index).

## Overview

Public interface for external users with Solana wallet payments and two operation modes.

## Access

- **Public UI**: `http://localhost:3000/client`
- **Admin panel** (auth required): `http://localhost:3000/ui`
- **Teleoperator** (registration / login; requires `DATABASE_URL` on the server): `http://localhost:3000/teleoperator`

## Modes

### Direct Mode
- User sees all available robots
- Direct choice of robot and action
- Full control over executor selection

### Task Router mode (API value `raid`)
- Individual robots are hidden
- System selects the best executor automatically
- Uses AI agent for selection

## Wallet integration

All SOL-compatible wallets are supported:
- Phantom
- Backpack
- Solflare
- Other Solana Wallet Adapter–compatible wallets

## Payment flow

1. User selects an action
2. System shows estimated cost
3. User connects wallet
4. On execute:
   - Get invoice from robot (if payment required)
   - Sign transaction in wallet
   - Send transaction to blockchain
   - Confirm payment to robot
   - Run command
5. On execution error: automatic refund

## API endpoints

### GET `/api/client/robots`
List available robots (Direct mode).

### GET `/api/client/commands`
List available commands (Task Router mode; API `mode`: `raid`).

### GET `/api/client/settings`
Get RPC and client settings (no API key).

### POST `/api/client/settings`
Save RPC settings (provider, Helius API key, custom URL).

### POST `/api/client/estimate`
Get estimated price for an action.
```json
{
  "mode": "direct" | "raid",
  "robotId": "robot-id",
  "command": "command-name",
  "parameters": {}
}
```

### POST `/api/client/execute`
Execute action with client payment (retry to robot with X-X402-Reference).
```json
{
  "mode": "direct" | "raid",
  "robotId": "robot-id",
  "command": "command-name",
  "parameters": {},
  "paymentSignature": "transaction-signature",
  "paymentTransaction": {
    "signature": "signature",
    "receiver": "wallet-address",
    "amount": 0.001,
    "asset": "SOL",
    "reference": "payment-reference"
  }
}
```

## AI agent for executor selection

### Built-in strategies

- **smart** (default): Price, location, and availability
- **lowest_price**: Cheapest robot
- **closest**: Closest robot
- **fastest**: Robot with freshest health check

### N8N integration

To use N8N for selection:

1. Create a webhook in N8N
2. Set:
   ```
   N8N_WEBHOOK_URL=https://your-n8n-instance.com/webhook/robot-selection
   ```

N8N webhook receives:
```json
{
  "robots": [...],
  "command": "command-name",
  "parameters": {},
  "context": {}
}
```

And returns:
```json
{
  "selectedRobotId": "robot-id",
  "reason": "Selection reason",
  "confidence": 0.9
}
```

## Configuration

### Environment variables

```bash
# Admin panel auth
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-secure-password

# AI Agent
AI_AGENT_STRATEGY=smart
N8N_WEBHOOK_URL=  # optional

# Solana RPC (payment verification)
SOLANA_RPC_PROVIDER=helius
HELIUS_API_KEY=your-key
```

## Security

- Admin panel uses basic HTTP auth
- Payments are verified on-chain before running the command
- Refund initiated on execution errors
- All transactions are signed by the user in the wallet

## Development

### File structure

```
public/client/
  index.html
  styles.css
  app.js

src/
  routes/client.js
  services/
    clientPaymentService.js
    settingsStore.js
    aiAgentService.js
  middleware/adminAuth.js
```

## Known limitations

1. Refund requires server wallet setup (in progress)
2. N8N is optional; built-in strategies are used by default
3. Payment verification requires Solana RPC URL (Helius or custom)
