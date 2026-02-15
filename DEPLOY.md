# Deployment Guide (Kasplex Testnet)

This guide deploys the full stack on the Kasplex EVM testnet.

## Architecture

- Web (`apps/web`) → Vercel (public)
- API (`apps/api`) → Railway (public)
- Ponder (`apps/ponder`) → Railway (private)
- Postgres → Railway (private)

## Prerequisites

- GitHub repo access
- Railway account
- Vercel account

Environment templates:
- `deploy/env/railway-api.env`
- `deploy/env/railway-ponder.env`
- `deploy/env/vercel-web.env`

## 1) Railway: Postgres + Services

1. Create a Railway project from the GitHub repo.
2. Add a Postgres database.
3. Create two services in the same project:
   - `tickasting-api`
   - `tickasting-ponder`

## 2) API Service (`tickasting-api`)

Build:

```bash
pnpm --filter @tickasting/api db:generate \
  && pnpm --filter @tickasting/shared build \
  && pnpm --filter @tickasting/api build
```

Start:

```bash
API_HOST=0.0.0.0 pnpm --filter @tickasting/api start
```

Railway settings:
- Root Directory: `.`
- Healthcheck Path: `/health`
- Public Networking: ON

Required env vars (see template for full list):
- `DATABASE_URL=${{Postgres.DATABASE_URL}}`
- `API_HOST=0.0.0.0`
- `API_DATABASE_SCHEMA=api`
- `CORS_ORIGINS=https://tickasting.studioliq.com`
- `TICKET_SECRET=<random-long-string>`
- `PURCHASE_MODE=evm`
- `USE_PONDER_DATA=true`
- `PONDER_SCHEMA=public`
- `PONDER_RPC_URL_167012=https://rpc.kasplextest.xyz`
- `CONTRACT_RPC_URL=https://rpc.kasplextest.xyz`
- `PAYMENT_TOKEN_ADDRESS=0x593Cd4124ffE9D11B3114259fbC170a5759E0f54`

Sync env via CLI (optional):

```bash
pnpm env:sync:railway
```

## 3) Ponder Service (`tickasting-ponder`)

Build:

```bash
pnpm --filter @tickasting/ponder typecheck
```

Start:

```bash
pnpm --filter @tickasting/ponder start
```

Railway settings:
- Root Directory: `.`
- Healthcheck Path: `/health` (or `/ready`)
- Public Networking: OFF

Required env vars (see template for full list):
- `DATABASE_URL=${{Postgres.DATABASE_URL}}`
- `DATABASE_SCHEMA=public`
- `PONDER_RPC_URL_167012=https://rpc.kasplextest.xyz`
- `PAYMENT_TOKEN_ADDRESS=0x593Cd4124ffE9D11B3114259fbC170a5759E0f54`
- `USDC_TRANSFER_START_BLOCK=0`
- `TICKASTING_CONTRACT_ADDRESS=0x<deployed-contract-address>`
- `TICKASTING_START_BLOCK=<deploy-block>`

## 4) Database Migrations (One-Time)

Run in the API service shell or a Railway job:

```bash
pnpm --filter @tickasting/api db:generate
pnpm --filter @tickasting/api exec prisma migrate deploy
```

Optional seed:

```bash
pnpm --filter @tickasting/api db:seed
```

## 5) Vercel (`apps/web`)

1. Create a Vercel project from the GitHub repo.
2. Root Directory: `apps/web`
3. Add env vars from `deploy/env/vercel-web.env`.

Required env vars (minimum):
- `NEXT_PUBLIC_API_URL=https://api-tickasting.studioliq.com`
- `NEXT_PUBLIC_EVM_EXPLORER_URL=https://explorer.testnet.kasplextest.xyz`
- `NEXT_PUBLIC_TICKASTING_CONTRACT_ADDRESS=0x<deployed-contract-address>`
- `NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS=0x593Cd4124ffE9D11B3114259fbC170a5759E0f54`
- `NEXT_PUBLIC_PAYMENT_TOKEN_SYMBOL=USDC`
- `NEXT_PUBLIC_PAYMENT_TOKEN_DECIMALS=6`
- `NEXT_PUBLIC_KASPLEX_CHAIN_ID=167012`

Redeploy after changes.

## 6) Contract Deployment (Optional, Claim Flow)

`contracts/.env`:

```dotenv
CONTRACT_RPC_URL=https://rpc.kasplextest.xyz
DEPLOYER_PRIVATE_KEY=<private-key>
```

Commands:

```bash
pnpm --filter @tickasting/contracts compile
pnpm --filter @tickasting/contracts test
pnpm --filter @tickasting/contracts deploy:kasplex-testnet
pnpm --filter @tickasting/contracts export-abi
```

Update `TICKASTING_CONTRACT_ADDRESS` in API, Ponder, and Web envs.

## 7) Smoke Test

```bash
curl https://api-tickasting.studioliq.com/health
curl https://<ponder-internal-url>/health
curl https://<ponder-internal-url>/ready
```

Create a sale and publish:

```bash
curl -X POST https://api-tickasting.studioliq.com/v1/events \
  -H "Content-Type: application/json" \
  -d '{"title":"Demo Concert","venue":"Online"}'

curl -X POST https://api-tickasting.studioliq.com/v1/events/<eventId>/sales \
  -H "Content-Type: application/json" \
  -d '{
    "network":"kasplex-testnet",
    "treasuryAddress":"0x<YOUR_EVM_TREASURY_ADDRESS>",
    "ticketPriceSompi":"1000000",
    "supplyTotal":10,
    "finalityDepth":12
  }'

curl -X POST https://api-tickasting.studioliq.com/v1/sales/<saleId>/publish
```

Check pages:
- `https://tickasting.studioliq.com/sales/<saleId>`
- `https://tickasting.studioliq.com/sales/<saleId>/live`
- `https://tickasting.studioliq.com/sales/<saleId>/results`
