# x402 Protocol (client flow in Task Router)

This app acts as an **x402 client** when calling paid robot endpoints. We implement the same exchange schema as the robot (x402 V2, x402scan/Bazaar compatible) so that 402 responses and retries are consistent.

## Version

We expect and parse **x402 V2** responses (`x402Version: 2`). Discovery and 402 bodies follow the [Register Resource](https://www.x402scan.com/resources/register) / x402 V2 shape.

---

## 1. Calling a paid robot endpoint

1. **First request** – Same URL, method, and body as for a free endpoint. No payment headers.
2. If the robot requires payment, it responds with **HTTP 402 Payment Required** and a JSON body:

```ts
{
  x402Version: 2,
  error?: string,
  accepts: Array<{
    scheme: "exact",
    network: string,        // CAIP-2 (e.g. solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp)
    amount: string,         // Numeric string (e.g. "0.00005")
    payTo: string,         // Solana receiver address
    maxTimeoutSeconds: number,
    asset: string,          // e.g. "SOL"
    extra: Record<string, any>  // reference, expires_in_sec, etc.
  }>,
  resource?: { url: string, description: string, mimeType: string },
  extensions?: { bazaar?: { ... } }
}
```

3. We take **reference** from `accepts[0].extra.reference`, **payTo** from `accepts[0].payTo`, **amount** and **asset** from `accepts[0]`.
4. We perform the payment (gateway or direct Solana transfer to `payTo`).
5. **Retry** – Same URL, method, and body, with header **`X-X402-Reference: <reference>`** (or body `x402_reference` for POST/PUT).
6. Robot verifies payment on-chain and returns **200** with the result.

---

## 2. Parsing 402 in this app

- **`parse402PaymentRequest(data)`** (in `commandRouter.js`) supports:
  - **V2:** `data.x402Version === 2` and `data.accepts[0]` → `reference`, `receiver = payTo`, `amount`, `asset`.
  - **Legacy:** Top-level `reference`, `receiver` (or `payTo`), `amount`, `asset`.
- Settled invoice is passed to the payment provider as `{ reference, receiver, amount, asset }`; `receiver` is the Solana address to pay (`payTo` in V2).

---

## 3. Headers and body on retry

- **Header:** `X-X402-Reference: <reference>`
- **Or body:** `{ "x402_reference": "<reference>" }` for POST/PUT.

We use the header for robot command retries.

---

## 4. Payment providers

- **Gateway:** We POST the invoice to the configured gateway; it settles and we retry with `X-X402-Reference`.
- **Solana direct:** We send a SOL transfer to `receiver` (payTo) for `amount` via `@solana/web3.js`, then retry with `X-X402-Reference`. The robot verifies on-chain (no facilitator).

---

## 5. Consistency checklist

- [x] We parse 402 V2 `accepts[0]` and use `extra.reference`, `payTo`, `amount`, `asset`.
- [x] We retry with `X-X402-Reference` (no other change to URL/method/body).
- [x] We support both gateway and direct Solana settlement; invoice shape is normalised to `reference`, `receiver`, `amount`, `asset` (receiver = payTo for V2).

For the robot-side schema (402 response shape, discovery, verification), see the robot repo’s `X402_PROTOCOL.md` and [x402 Register Resource](https://www.x402scan.com/resources/register).
