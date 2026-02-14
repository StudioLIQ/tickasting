# Data Migration: Legacy Indexer → Ponder

## Status
- **Created**: 2026-02-14 (GP-033)
- **Strategy**: Full reindex for EVM data, legacy indexer remains for Kaspa tx scanning

## Context

The migration from `apps/indexer` to `apps/ponder` affects two data domains differently:

### Domain 1: EVM Contract Events (Ponder replaces legacy)
- **Source**: TickastingSale contract on Sepolia
- **Events**: SaleCreated, TicketTypeDefined, ClaimOpened, TicketClaimed, SaleFinalized
- **Legacy approach**: Manual sync via `POST /v1/sales/:saleId/claims/sync`
- **Ponder approach**: Automatic event indexing into `claims_onchain`, `sales_onchain`, etc.
- **Migration**: Full reindex from contract deployment block. No data to migrate — Ponder rebuilds from chain.

### Domain 2: Kaspa Transaction Scanning (legacy remains)
- **Source**: Kaspa network (treasury address transactions)
- **Operations**: Tx detection, validation, acceptance tracking, ordering
- **Tables**: `purchase_attempts` (Prisma)
- **Migration**: Not migrated to Ponder. Kaspa is not EVM, so Ponder can't index it natively.
- **Future**: If Ponder adds custom chain support or Kaspa adds EVM compatibility, this can be revisited.

## Migration Strategy: Full Reindex

For EVM contract events, the recommended strategy is full reindex:

1. **Set `TICKASTING_START_BLOCK`** to the contract deployment block number
2. **Start Ponder** — it will index all events from the start block to current
3. **Validate** — compare Ponder's `claims_onchain` with legacy `tickets` table
4. **Switch** — set `USE_PONDER_DATA=true` on the API

### Why Full Reindex (not incremental)

- Sepolia block times are ~12s, and the contract has limited events
- Full reindex from deployment block takes minutes, not hours
- Simpler than maintaining checkpoint state between two systems
- Ponder handles this natively with its built-in sync engine

## Validation

### Consistency Check Endpoint

```bash
# Compare off-chain winners (Prisma) with on-chain claims (Ponder)
curl https://<api-domain>/v1/sales/<saleId>/claims/consistency
```

Expected response when consistent:
```json
{
  "saleId": "...",
  "claimSource": "ponder",
  "consistent": true,
  "totalWinners": 10,
  "totalClaimed": 10,
  "unclaimedWinners": [],
  "unknownClaims": []
}
```

### Manual Verification

```bash
# Ponder claims
curl https://<api-domain>/v1/sales/<saleId>/claims?source=ponder

# Legacy claims
curl https://<api-domain>/v1/sales/<saleId>/claims?source=legacy
```

Compare `totalClaimed` counts and individual claim records.

## Cutover Checklist

### Pre-cutover
- [ ] Ponder is deployed and indexing on Railway
- [ ] Ponder `/ready` returns 200
- [ ] `claims_onchain` table has data matching legacy `tickets` table
- [ ] Consistency check passes for all active sales
- [ ] API health shows `"ponder": "ok"`

### Cutover
- [ ] Set `USE_PONDER_DATA=true` in API environment variables
- [ ] Restart API service
- [ ] Verify `/health` shows `"usePonderData": true`

### Post-cutover
- [ ] FE claim status displays correctly
- [ ] New claims are indexed by Ponder within seconds
- [ ] Consistency check still passes
- [ ] Legacy indexer can be stopped (for EVM events only)

### Rollback
- [ ] Set `USE_PONDER_DATA=false` in API environment variables
- [ ] Restart API service
- [ ] Legacy data remains intact in `tickets` table

## Dual-Run Period

During the transition, both systems operate:
- Legacy indexer: Handles Kaspa tx scanning + ordering (still needed)
- Ponder: Handles EVM contract event indexing (new)
- API: Reads from both, with `USE_PONDER_DATA` controlling claim data source

This dual-run period continues until:
1. All EVM event consumers use Ponder data
2. Kaspa tx scanning is either migrated or confirmed to stay in legacy
