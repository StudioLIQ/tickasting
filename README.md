# Tickasting

Fair ticketing engine powered by Kasplex EVM on-chain ordering and deterministic ranking.

> The server does not decide queue order. The chain data does.

## Overview

Tickasting is a ticketing system designed to make queue ordering reproducible and auditable.

- Purchase attempts are validated from on-chain data.
- Ranking is deterministic (`blockNumber` then `logIndex` then `txHash`).
- Buyers can verify outcomes from published allocation data.
- Payment and claim/mint flows are both indexed from EVM events.

## Current Runtime Topology

Tickasting runs with a single indexing layer:

- `apps/ponder`: EVM event indexing for payment + claim data

Details: `docs/architecture.md`, `docs/migration-ponder.md`

## Monorepo Structure

```text
apps/
  web/       Next.js frontend
  api/       Fastify API + WebSocket + domain logic
  ponder/    EVM event indexer (payment/claims/ownership)
contracts/   TickastingSale Solidity contract (Kasplex testnet)
packages/
  shared/    Shared libs (merkle/ticket/utility)
infra/
  docker-compose.yml   Local postgres/redis
```

## Prerequisites

- Node.js `>=20`
- pnpm `>=9`
- Docker + Docker Compose

## Quick Start (Local Core)

This path runs core flow locally: `web + api + ponder + postgres`.

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
API_DATABASE_SCHEMA=api
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,https://tickasting.studioliq.com
PURCHASE_MODE=evm
NEXT_PUBLIC_API_URL=http://localhost:4001
NEXT_PUBLIC_WS_URL=ws://localhost:4001
NEXT_PUBLIC_EVM_EXPLORER_URL=https://explorer.testnet.kasplextest.xyz
NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS=0x593Cd4124ffE9D11B3114259fbC170a5759E0f54
NEXT_PUBLIC_PAYMENT_TOKEN_SYMBOL=USDC
NEXT_PUBLIC_PAYMENT_TOKEN_DECIMALS=6
NEXT_PUBLIC_KASPLEX_CHAIN_ID=167012
PAYMENT_CURRENCY=USDC
PAYMENT_TOKEN_ADDRESS=0x593Cd4124ffE9D11B3114259fbC170a5759E0f54
PAYMENT_CHAIN=kasplex-testnet
USE_PONDER_DATA=true
DATABASE_SCHEMA=public
```

Vercel production (`apps/web`) values:

```dotenv
NEXT_PUBLIC_API_URL=https://api-tickasting.studioliq.com
NEXT_PUBLIC_WS_URL=wss://api-tickasting.studioliq.com # optional, auto-derived if omitted
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
pnpm --filter @tickasting/ponder dev
```

Terminal 4:

```bash
pnpm --filter @tickasting/web dev
```

### 6) Health checks

```bash
curl http://localhost:4001/health
curl http://localhost:42069/health
curl http://localhost:42069/ready
```

Web app: `http://localhost:3000`

## Ponder Setup

```dotenv
PONDER_RPC_URL_167012=https://rpc.kasplextest.xyz
USDC_TRANSFER_START_BLOCK=0
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
    "network":"kasplex-testnet",
    "treasuryAddress":"0x<YOUR_EVM_TREASURY_ADDRESS>",
    "ticketPriceSompi":"1000000",
    "supplyTotal":10,
    "finalityDepth":12
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
- `GET /v1/tickets?ownerAddress=...`
- `GET /v1/tickets/:ticketId`
- `GET /v1/tickets/:ticketId/metadata`
- `PATCH /v1/tickets/:ticketId/transfer`
- `PATCH /v1/tickets/:ticketId/cancel`

### Real-time

- `WS /ws/sales/:saleId`

### Health

- `GET /health` (API)
- `GET /health`, `GET /ready`, `GET /status` (Ponder)

## Environment Variables

Commonly used variables:

- `DATABASE_URL` Postgres DSN
- `API_HOST`, `API_PORT` API listen config (`PORT` is prioritized for container platforms)
- `API_DATABASE_SCHEMA` API Prisma schema name (default `api` in start script)
- `CORS_ORIGINS` comma-separated CORS allowlist for browser origins
- `PURCHASE_MODE=evm` EVM purchase ordering mode
- `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL` web runtime targets (`NEXT_PUBLIC_WS_URL` is optional if API URL is set)
- `NEXT_PUBLIC_EVM_EXPLORER_URL` web explorer base URL for tx/block links
- `NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS`, `NEXT_PUBLIC_PAYMENT_TOKEN_SYMBOL`, `NEXT_PUBLIC_PAYMENT_TOKEN_DECIMALS`
- `NEXT_PUBLIC_KASPLEX_CHAIN_ID` expected chain id for wallet UX
- `WS_BROADCAST_INTERVAL_MS` API websocket broadcast interval
- `TICKET_SECRET` ticket QR signing secret
- `USE_PONDER_DATA` API claim data source switch
- `PONDER_SCHEMA` schema name for ponder tables (default `public`)
- `DATABASE_SCHEMA` Ponder database schema name (default `public`)
- `PONDER_RPC_URL_167012`, `USDC_TRANSFER_START_BLOCK`, `TICKASTING_CONTRACT_ADDRESS`, `TICKASTING_START_BLOCK` ponder config
- `CONTRACT_RPC_URL`, `DEPLOYER_PRIVATE_KEY` contract deployment
- `PAYMENT_CURRENCY`, `PAYMENT_TOKEN_ADDRESS`, `PAYMENT_CHAIN` payment config (USDC on Kasplex testnet)

See `.env.example` and the Quick Start section in this README for concrete setups.
Deployment bulk env templates: `deploy/env/vercel-web.env`, `deploy/env/railway-api.env`, `deploy/env/railway-ponder.env`.
You can sync them automatically with one command:

```bash
pnpm env:sync
```

Partial sync commands:

```bash
pnpm env:sync:vercel
pnpm env:sync:railway
pnpm env:sync:dry-run
```

## Testing

```bash
pnpm test
pnpm --filter @tickasting/shared test
pnpm --filter @tickasting/ponder typecheck
pnpm --filter @tickasting/api test
```

## License

MIT (`LICENSE`)
