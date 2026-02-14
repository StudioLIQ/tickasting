# Architecture Decision Record: Runtime Topology

> Status: **Accepted** (GP-027, 2026-02-14)

## Context

Tickasting started with a custom polling-based indexer (`apps/indexer`) that handles:
- Treasury address transaction scanning
- Payload/PoW validation
- Acceptance/confirmations tracking
- Deterministic ordering

This approach works but has limitations:
- Custom polling loops are hard to make reorg-safe
- No built-in checkpointing or replay
- Manual batch processing of chain data
- Tightly coupled to Kas.fyi API polling patterns

Ponder is a purpose-built indexing framework that provides:
- Declarative event/transaction indexing
- Built-in reorg handling and idempotency
- Automatic schema management and migrations
- Health/metrics endpoints out of the box

## Decision

### Target Architecture

```
Component        Runtime         Notes
───────────────────────────────────────────────────────
Web App          Vercel          Next.js, static + SSR
API Server       Railway         Fastify, domain logic / auth / aggregation
Ponder Worker    Railway         Chain event/tx indexing (replaces apps/indexer)
PostgreSQL       Railway         Single source of truth
Contract         Sepolia (EVM)   ERC-721 claim/mint (TickastingSale)
Kaspa Network    Testnet/Main    Purchase tx source
```

### Data Source Responsibility

| Layer | Responsibility |
|-------|---------------|
| **Ponder** (`apps/ponder`) | Chain event/transaction indexing. Writes raw indexed data to Postgres tables. Handles reorgs, checkpointing, and replay. Tracks: tx detection, acceptance, confirmations, contract events (SaleCreated, TicketClaimed, etc.). |
| **API** (`apps/api`) | Domain logic, access control, aggregation. Reads from Ponder-managed tables + own domain tables. Computes rankings, generates allocation snapshots, serves buyer/organizer endpoints. Does NOT poll the chain directly. |
| **Web** (`apps/web`) | Presentation. Calls API for data, connects via WebSocket for real-time updates. Runs client-side PoW in WebWorker. |

### Deprecated Components

- **`apps/indexer`**: Legacy custom polling indexer. Remains in the repo during the transition period (GP-028 through GP-035) but is officially deprecated. No new features should be added to `apps/indexer`. After GP-033 (data migration) and GP-035 (cleanup), it will be removed entirely.

## Migration Path

The transition from `apps/indexer` to `apps/ponder` follows these tickets:

1. **GP-027** (this ticket): Architecture decision formalized
2. **GP-028**: Ponder app scaffolding + workspace integration
3. **GP-029**: Contract event indexing implementation in Ponder
4. **GP-030**: API refactor to read from Ponder tables
5. **GP-031**: FE update for multi ticket type + on-chain claim UX
6. **GP-032**: Railway deployment topology (API + Ponder + Postgres)
7. **GP-033**: Data migration from legacy indexer to Ponder
8. **GP-034**: Observability/monitoring for Ponder indexing
9. **GP-035**: Legacy indexer removal + code cleanup

### Dual-Run Period

During GP-028 through GP-033, both `apps/indexer` and `apps/ponder` may coexist:
- `apps/indexer` continues to serve production/demo traffic
- `apps/ponder` is developed and validated in parallel
- API adds feature flags or query routing to switch between data sources
- Cutover happens after GP-033 validates data consistency

## Consequences

### Positive
- Reorg-safe indexing out of the box
- Declarative schema + handler model reduces boilerplate
- Built-in health metrics and replay capability
- Cleaner separation: Ponder handles chain data, API handles domain logic

### Negative
- Ponder is an additional dependency with its own learning curve
- Dual-run period adds temporary complexity
- Existing indexer tests/fixtures need porting

### Risks
- Ponder may not natively support Kaspa (non-EVM). Mitigation: use Ponder for EVM contract events; for Kaspa tx scanning, either extend Ponder with a custom source or keep a thin adapter layer.
- Migration data consistency. Mitigation: GP-033 includes validation checks and dual-write period.
