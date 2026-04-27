# x402 Protocol Implementation (exchange schema)

This document is the single source of truth for how x402 is implemented **between our services** and with external clients. Use it to keep REST, ROS service, discovery, and payment verification consistent everywhere.

## Version

We implement **x402 V2** (x402scan/Bazaar compatible). All 402 responses and discovery documents use `x402Version: 2`.

---

## 1. HTTP 402 response (paid REST endpoints)

When a client calls a paid endpoint without a valid payment reference, the server responds with **HTTP 402 Payment Required** and a JSON body that **must** conform to this shape:

```ts
{
  x402Version: 2,
  error?: string,
  accepts: Array<{
    scheme: "exact",
    network: string,        // CAIP-2 (e.g. solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp)
    amount: string,         // Numeric string (e.g. "0.00005")
    payTo: string,          // Solana receiver address
    maxTimeoutSeconds: number,
    asset: string,          // e.g. "SOL"
    extra: Record<string, any>  // Required; we put reference, expires_in_sec here
  }>,
  resource?: { url: string, description: string, mimeType: string },
  extensions?: { bazaar?: { info?: {...}, schema?: {...} } }
}
```

- **reference** for the session is in `accepts[0].extra.reference`.
- Client must pay **amount** (in SOL) to **payTo** on **network**, then retry the same request with header **`X-X402-Reference`** = `accepts[0].extra.reference` (or body field `x402_reference`).

---

## 2. Client retry after payment

- **Header**: `X-X402-Reference: <reference>`
- **Or body**: `{ "x402_reference": "<reference>" }` (for POST/PUT).
- Same URL, same method, same body as the first request. No other change required.

---

## 3. Discovery: GET /.well-known/x402

- **Method**: GET  
- **Response**: 200, JSON:

```ts
{
  x402Version: 2,
  resources: Array<{
    url: string,           // Full URL (base_url + path)
    description: string,
    mimeType: string,
    accepts: Array<{ ... }>,  // Same shape as in 402; empty for free endpoints
    extensions?: { bazaar?: {...} }
  }>
}
```

- **base_url** comes from server config or `Host` header. Each paid endpoint appears as one resource with one or more `accepts` entries (Solana).

---

## 4. Payment verification (our server)

- Sessions are stored in memory keyed by **reference**.
- On retry with `X-X402-Reference`, the server:
  1. Looks up the session by reference.
  2. If expired → 402 again (error message).
  3. Calls **Solana RPC**: `getSignaturesForAddress(receiver)` then for each signature `getTransaction(signature, encoding: jsonParsed)`.
  4. Scans transaction instructions for **parsed.type === "transfer"**, **info.destination === receiver**, **info.lamports >= expected_lamports**.
  5. On first match: marks session as verified, continues to execute the action and return 200.
- No facilitator required; verification is on-chain only (configurable `facilitator_url` exists for optional delegation).

---

## 5. ROS service `x402_buy_service` (robot as payer)

When the **robot** pays an external x402 service:

- Caller provides: **endpoint** (URL), **method**, **payload**, **headers_json**, **amount**, **asset_symbol**, **payer_account** (receiver = payTo).
- Node sends a Solana transfer from the loaded key to **payer_account** for **amount** SOL, then performs the HTTP request to **endpoint** (e.g. with `X-X402-Payment-Signature` or as required by the external service).
- External services may return **402 with x402 V2**; the developer can use the **x402-bazaar** CLI to discover resources and get **payTo** and **amount** from `accepts[0]`, then call the ROS service with those values.

---

## 6. Config fields affecting x402

| Field           | Use |
|----------------|-----|
| `base_url`     | Used for `resource.url` in 402 and for `resources[].url` in discovery. If absent, derived from `Host`. |
| `x402_network` | CAIP-2 string for `accepts[].network` (e.g. `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`). Defaults to Solana mainnet in code. |
| `x402_pricing` | Per-endpoint: `amount`, `asset_symbol`, `receiver_account`, `payment_window_sec`. |

---

## 7. Consistency checklist

- [ ] All 402 responses include `x402Version: 2` and `accepts[]` with `extra` present.
- [ ] Discovery at `/.well-known/x402` returns `x402Version: 2` and `resources[]`.
- [ ] Clients use `X-X402-Reference` (or `x402_reference` in body) when retrying after payment.
- [ ] Payment verification uses only on-chain Solana data (signatures + parsed transfer instructions) unless a facilitator is configured.
