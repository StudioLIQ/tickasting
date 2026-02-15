# Architecture Decision Record: Runtime Topology

> Status: **Accepted** (Updated 2026-02-16)

## Context

Tickasting currently operates in an **EVM-only purchase flow** on Kasplex testnet:

- Payment ordering source: ERC-20 `Transfer` events (USDC)
- Claim source: `TickastingSale` contract events
- Real-time updates: API WebSocket stream

The runtime must keep chain indexing reorg-safe and deterministic for ranking.

## Decision

### Target Architecture

```text
Component        Runtime         Notes
───────────────────────────────────────────────────────
Web App          Vercel          Next.js buyer/organizer UI
API Server       Railway         Fastify domain logic + WebSocket
Ponder Worker    Railway         EVM event indexing (payment/claims)
PostgreSQL       Railway         Single source of truth
Contract         Kasplex EVM     TickastingSale claim/mint contract
```

### Data Source Responsibility

| Layer | Responsibility |
|-------|---------------|
| **Ponder** (`apps/ponder`) | Indexes EVM events into Postgres (`payment_transfers_onchain`, `claims_onchain`, etc.). Handles sync/reorg/replay. |
| **API** (`apps/api`) | Reads indexed chain data + domain tables, computes rankings/allocation, exposes REST/WS APIs, ticket lifecycle (issue/transfer/cancel/redeem). |
| **Web** (`apps/web`) | Buyer-facing UI (sales browsing, purchase flow, my tickets, ticket metadata). |

## Removed Component

- `apps/indexer` was removed after migration completion.
- Any legacy Kaspa polling path is no longer part of runtime deployment.

## Consequences

### Positive

- Single indexing path (`apps/ponder`) simplifies ops and debugging.
- Deterministic ordering is based on indexed on-chain EVM data only.
- Deployment topology is clearer: `web + api + ponder + postgres`.

### Trade-offs

- Runtime depends on Ponder health/readiness.
- Start-block and contract address configuration must be correct for indexing.
