# Tickasting

**Fair Ticketing Engine Powered by Kaspa**

> The server doesn't create the queue. The chain does. Verifiable by anyone.

## Overview

Tickasting is a zero-lag ticketing system built on Kaspa blockchain. Instead of a central server determining queue order, Tickasting uses on-chain acceptance data to create a **deterministic, verifiable ordering** that anyone can reproduce.

### Key Features

- **Deterministic Ordering**: Rankings based on `acceptingBlockHash.blueScore` + `txid` tiebreaker
- **Provisional vs Final**: Two-stage UX showing real-time status and finality
- **Anti-Bot PoW**: Client-side proof-of-work to increase cost for mass submissions
- **Verifiable Results**: `allocation.json` snapshot for audit

### Why Tickasting?

Traditional ticketing systems suffer from:
- **Queue manipulation**: Servers can (intentionally or not) favor certain users
- **Bot advantage**: Fast networks and automation beat regular users
- **No verification**: Users have no way to verify their position was fair

Tickasting solves this by:
- Using blockchain acceptance order instead of server timestamps
- Requiring proof-of-work to increase bot costs
- Publishing all ordering rules and data for anyone to verify

## Quick Start

### Prerequisites

- Node.js >= 20
- pnpm >= 9
- Docker & Docker Compose
- KasWare wallet (for testing purchases)

### 1. Clone and Install

```bash
git clone https://github.com/your-org/tickasting.git
cd tickasting
pnpm install
```

### 2. Start Infrastructure

```bash
docker compose -f infra/docker-compose.yml up -d
```

### 3. Configure Environment

```bash
cp .env.example .env
# Edit .env with your settings (see Environment Variables below)
```

### 4. Initialize Database

```bash
cd apps/api
pnpm db:generate
pnpm db:migrate
pnpm db:seed
cd ../..
```

### 5. Run Development Servers

```bash
pnpm dev
```

This starts:
- **Web**: http://localhost:3000
- **API**: http://localhost:4001
- **Ponder**: http://localhost:42069 (EVM indexer, if configured)
- **Indexer** (legacy): http://localhost:4002 (Kaspa tx scanning)

### Health Checks

```bash
curl http://localhost:4001/health
curl http://localhost:4002/health
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://tickasting:tickasting@localhost:5433/tickasting` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `API_PORT` | API server port | `4001` |
| `INDEXER_PORT` | Indexer service port | `4002` |
| `INDEXER_POLL_INTERVAL_MS` | Transaction polling interval | `5000` |
| `KASFYI_API_KEY` | Kas.fyi API key (optional for rate limits) | - |
| `KASPA_NETWORK` | Network (`mainnet` or `testnet`) | `testnet` |
| `NEXT_PUBLIC_API_URL` | API URL for frontend | `http://localhost:4001` |
| `NEXT_PUBLIC_WS_URL` | WebSocket URL for frontend | `ws://localhost:4001` |

## Demo Walkthrough

### Step 1: Create an Event and Sale

```bash
# Create event
curl -X POST http://localhost:4001/v1/events \
  -H "Content-Type: application/json" \
  -d '{"title": "Demo Concert", "venue": "Virtual Arena"}'

# Create sale (use the eventId from response)
curl -X POST http://localhost:4001/v1/events/{eventId}/sales \
  -H "Content-Type: application/json" \
  -d '{
    "treasuryAddress": "kaspa:your-testnet-address",
    "ticketPriceSompi": "100000000",
    "supplyTotal": 10,
    "powDifficulty": 8
  }'

# Publish sale (use saleId from response)
curl -X POST http://localhost:4001/v1/sales/{saleId}/publish
```

### Step 2: Purchase Flow

1. Open http://localhost:3000/sales/{saleId}
2. Connect your KasWare wallet
3. Click "Purchase" - browser computes PoW
4. Approve transaction in wallet
5. Watch your status update in real-time

### Step 3: View Results

1. Open http://localhost:3000/sales/{saleId}/results
2. Search by transaction ID
3. Download `allocation.json` for verification

## Verification Guide

### Verify Ordering Rules

All rankings follow this deterministic order:
1. **Primary**: `acceptingBlueScore` ascending
2. **Tiebreaker**: `txid` lexicographic ascending

To verify independently:
1. Get all purchase transactions from the treasury address
2. Filter by valid payload (magic: `TKS1`, correct saleId)
3. Get acceptance data for each transaction
4. Sort by blueScore, then txid
5. Compare with `allocation.json` winners list

### Verify PoW

Each payload contains a PoW nonce. Verify with:
```
message = "TickastingPoW|v1|{saleId}|{buyerAddrHash}|{nonce}"
hash = SHA256(message)
leadingZeroBits(hash) >= difficulty
```

## Project Structure

```
tickasting/
├── apps/
│   ├── web/           # Next.js frontend (Vercel)
│   │   └── app/
│   │       └── sales/[saleId]/
│   │           ├── page.tsx         # Purchase page
│   │           ├── live/page.tsx    # Live dashboard
│   │           └── results/page.tsx
│   ├── api/           # Fastify API server (Railway)
│   │   └── src/
│   │       └── routes/
│   ├── ponder/        # Ponder indexer (Railway, target)
│   └── indexer/       # Legacy indexer (deprecated)
├── contracts/         # Solidity ERC-721 (Sepolia)
├── packages/
│   └── shared/        # Shared utilities
│       └── src/
│           ├── payload.ts    # Encode/decode
│           ├── pow.ts        # PoW solve/verify
│           ├── merkle.ts     # Merkle tree
│           └── kaspa/        # Adapter interface
├── infra/
│   └── docker-compose.yml
├── docs/
│   ├── architecture.md   # Architecture decision record
│   ├── contract-spec.md  # Contract specification
│   └── audit.md          # Verification guide
├── PROJECT.md         # Full specification
└── TICKET.md          # Implementation tickets
```

## Architecture

> Indexing is transitioning from `apps/indexer` to Ponder (`apps/ponder`).
> See [docs/architecture.md](docs/architecture.md) for the full decision record.

```
┌─────────────┐     ┌─────────────┐     ┌─────────────────┐
│   Web App   │────▶│  API Server │────▶│    Database     │
│  (Vercel)   │     │  (Railway)  │     │  (Railway PG)   │
└─────────────┘     └─────────────┘     └─────────────────┘
       │                   ▲                     ▲
       │                   │                     │
       ▼                   │               ┌─────┘
┌─────────────┐     ┌─────────────┐     ┌──────────────────┐
│   Wallet    │     │   Ponder    │────▶│  Kaspa Network   │
│  (KasWare)  │────▶│  (Railway)  │────▶│  EVM (Sepolia)   │
└─────────────┘     └─────────────┘     └──────────────────┘
```

## API Endpoints

### Events & Sales
- `POST /v1/events` - Create event
- `POST /v1/events/:eventId/sales` - Create sale
- `POST /v1/sales/:saleId/publish` - Publish sale (scheduled → live)
- `POST /v1/sales/:saleId/finalize` - Start finalization
- `GET /v1/sales/:saleId` - Get sale details

### Buyer
- `GET /v1/sales/:saleId/my-status?txid=` - Get purchase status
- `GET /v1/sales/:saleId/stats` - Get sale statistics
- `GET /v1/sales/:saleId/allocation` - Get winners list

### Real-time
- `WS /ws/sales/:saleId` - Live updates stream

## Testing

```bash
# Run all tests
pnpm test

# Run specific package tests
pnpm --filter @tickasting/shared test
pnpm --filter @tickasting/indexer test
```

## Tech Stack

- **Monorepo**: pnpm + Turborepo
- **Web**: Next.js 15, React 19, Tailwind CSS
- **API**: Fastify 5, Zod, @fastify/websocket
- **Indexing**: Ponder 0.16 (EVM contract events)
- **Contracts**: Solidity, Hardhat, OpenZeppelin (Sepolia ERC-721)
- **Database**: PostgreSQL + Prisma
- **Shared**: TypeScript, Vitest

## License

MIT License - see [LICENSE](LICENSE)

---

Built for the Kaspa Hackathon 2026
