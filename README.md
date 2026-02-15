# Tickasting

Fair ticketing engine powered by Kaspa acceptance ordering and deterministic ranking.

> The server does not decide queue order. The chain data does.

## Overview

Tickasting is a ticketing system designed to make queue ordering reproducible and auditable.

- Purchase attempts are validated from on-chain data.
- Ranking is deterministic (`acceptingBlueScore` then `txid`).
- Buyers can verify outcomes from published allocation data.
- Optional claim/mint flow is indexed from EVM contract events.

Important distinction:

- Not "fully on-chain contract-side ranking"
- Yes "on-chain-data-driven ranking" from Kaspa acceptance metadata

## Current Runtime Topology

Tickasting currently runs with two index layers:

- `apps/indexer`: Kaspa transaction detection/validation/ordering (required for purchase flow)
- `apps/ponder`: EVM contract event indexing for claim data

Target architecture is migrating to Ponder-first for indexing responsibilities, but Kaspa scanning is still handled by `apps/indexer` today.

Details: `docs/architecture.md`, `docs/migration-ponder.md`

## Monorepo Structure

```text
apps/
  web/       Next.js frontend
  api/       Fastify API + WebSocket + domain logic
  indexer/   Kaspa scanner/validator/orderer (active for core flow)
  ponder/    EVM event indexer (claims/ownership)
contracts/   TickastingSale Solidity contract (Sepolia)
packages/
  shared/    Shared libs (payload, PoW, merkle, kaspa adapter)
infra/
  docker-compose.yml   Local postgres/redis
```

## Prerequisites

- Node.js `>=20`
- pnpm `>=9`
- Docker + Docker Compose

## Quick Start (Local Core)

This path runs core flow locally: `web + api + indexer + postgres`.

### 1) Install

```bash
pnpm install
cp .env.example .env
```

### 2) Start local infra

```bash
docker compose -f infra/docker-compose.yml up -d
```

### 3) Initialize DB

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

### 4) Set core env values

In `.env`:

```dotenv
DATABASE_URL=postgresql://tickasting:tickasting@localhost:5433/tickasting?schema=public
API_HOST=0.0.0.0
API_PORT=4001
INDEXER_PORT=4002
INDEXER_POLL_INTERVAL_MS=5000
KASPA_NETWORK=testnet
NEXT_PUBLIC_API_URL=http://localhost:4001
NEXT_PUBLIC_WS_URL=ws://localhost:4001
USE_PONDER_DATA=false
```

### 5) Run services

Terminal 1:

```bash
pnpm --filter @tickasting/shared dev
```

Terminal 2:

```bash
pnpm --filter @tickasting/api dev
```

Terminal 3:

```bash
pnpm --filter @tickasting/indexer dev
```

Terminal 4:

```bash
pnpm --filter @tickasting/web dev
```

### 6) Health checks

```bash
curl http://localhost:4001/health
curl http://localhost:4002/health
curl http://localhost:4002/stats
```

Web app: `http://localhost:3000`

## Full Stack Dev (Including Ponder)

If you also want EVM claim indexing locally:

```dotenv
PONDER_RPC_URL_11155111=https://sepolia.infura.io/v3/<key>
TICKASTING_CONTRACT_ADDRESS=0x<deployed-address>
TICKASTING_START_BLOCK=<deploy-block>
USE_PONDER_DATA=true
PONDER_SCHEMA=public
```

Then run:

```bash
pnpm --filter @tickasting/ponder dev
```

Ponder checks:

```bash
curl http://localhost:42069/health
curl http://localhost:42069/ready
curl http://localhost:42069/status
```

## Demo Flow

### 1) Create event

```bash
curl -X POST http://localhost:4001/v1/events \
  -H "Content-Type: application/json" \
  -d '{"title":"Demo Concert","venue":"Online"}'
```

### 2) Create sale

```bash
curl -X POST http://localhost:4001/v1/events/<eventId>/sales \
  -H "Content-Type: application/json" \
  -d '{
    "network":"testnet",
    "treasuryAddress":"kaspa:<YOUR_TESTNET_TREASURY_ADDRESS>",
    "ticketPriceSompi":"100000000",
    "supplyTotal":10,
    "powDifficulty":8
  }'
```

### 3) Publish sale

```bash
curl -X POST http://localhost:4001/v1/sales/<saleId>/publish
```

### 4) Check pages

- `http://localhost:3000/sales/<saleId>`
- `http://localhost:3000/sales/<saleId>/live`
- `http://localhost:3000/sales/<saleId>/results`

## API Surface (Core)

### Events

- `POST /v1/events`
- `GET /v1/events`
- `GET /v1/events/:eventId`

### Sales

- `POST /v1/events/:eventId/sales`
- `GET /v1/sales`
- `GET /v1/sales/:saleId`
- `POST /v1/sales/:saleId/publish`
- `POST /v1/sales/:saleId/finalize`
- `GET /v1/sales/:saleId/stats`
- `GET /v1/sales/:saleId/my-status?txid=...`
- `GET /v1/sales/:saleId/allocation`
- `POST /v1/sales/:saleId/commit`
- `GET /v1/sales/:saleId/merkle-proof?txid=...`

### Ticket Types

- `GET /v1/sales/:saleId/ticket-types`
- `POST /v1/sales/:saleId/ticket-types`
- `PATCH /v1/sales/:saleId/ticket-types/:ticketTypeId`

### Claims

- `GET /v1/sales/:saleId/claims`
- `POST /v1/sales/:saleId/claims/sync`
- `GET /v1/sales/:saleId/claims/consistency`
- `PATCH /v1/sales/:saleId/contract`

### Scanner

- `POST /v1/sales/:saleId/tickets/:txid/issue`
- `POST /v1/scans/verify`
- `POST /v1/scans/redeem`
- `GET /v1/tickets/:ticketId`

### Real-time

- `WS /ws/sales/:saleId`

### Health

- `GET /health` (API)
- `GET /health` and `GET /stats` (Indexer)

## Environment Variables

Commonly used variables:

- `DATABASE_URL` Postgres DSN
- `API_HOST`, `API_PORT` API listen config
- `INDEXER_PORT`, `INDEXER_POLL_INTERVAL_MS` indexer config
- `KASPA_NETWORK` (`testnet` or `mainnet`)
- `KASFYI_API_KEY`, `KASFYI_BASE_URL` Kaspa adapter config
- `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL` web runtime targets
- `WS_BROADCAST_INTERVAL_MS` API websocket broadcast interval
- `TICKET_SECRET` ticket QR signing secret
- `USE_PONDER_DATA` API claim data source switch
- `PONDER_SCHEMA` schema name for ponder tables (default `public`)
- `PONDER_RPC_URL_11155111`, `TICKASTING_CONTRACT_ADDRESS`, `TICKASTING_START_BLOCK` ponder config
- `CONTRACT_RPC_URL`, `DEPLOYER_PRIVATE_KEY`, `ETHERSCAN_API_KEY` contract deployment

See `.env.example` and the Quick Start section in this README for concrete setups.

## Testing

```bash
pnpm test
pnpm --filter @tickasting/shared test
pnpm --filter @tickasting/indexer test
pnpm --filter @tickasting/api test
```

## License

MIT (`LICENSE`)
