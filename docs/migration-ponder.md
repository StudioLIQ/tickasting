# Data Migration: Ponder Cutover (Completed)

## Status

- **Completed**: 2026-02-16
- **Runtime indexing path**: `apps/ponder` only

## Final State

Tickasting now uses a single indexing stack:

1. `apps/ponder` indexes EVM payment/claim events into Postgres
2. `apps/api` reads indexed data for ranking, claims, and ticket lifecycle
3. `apps/web` consumes API + WebSocket

`apps/indexer` (legacy polling service) is removed from the repository and is not part of deployment.

## Validation Endpoints

```bash
curl https://<api-domain>/health
curl https://<api-domain>/v1/sales/<saleId>/stats
curl https://<api-domain>/v1/sales/<saleId>/allocation
curl https://<api-domain>/v1/sales/<saleId>/claims
```

Consistency endpoint:

```bash
curl https://<api-domain>/v1/sales/<saleId>/claims/consistency
```

Expected:

- `claimSource` reports `ponder` when tables are available
- `consistent` is `true` for finalized, synced sales

## Operational Notes

- `PONDER_RPC_URL_167012`, `TICKASTING_CONTRACT_ADDRESS`, `TICKASTING_START_BLOCK` must be correct.
- API should run with `PURCHASE_MODE=evm` and `USE_PONDER_DATA=true`.
