# GhostPass

**Fair Ticketing Engine Powered by Kaspa**

> The server doesn't create the queue. The chain does. Verifiable by anyone.

## Overview

GhostPass is a zero-lag ticketing system built on Kaspa blockchain. Instead of a central server determining queue order, GhostPass uses on-chain acceptance data to create a **deterministic, verifiable ordering** that anyone can reproduce.

### Key Features

- **Deterministic Ordering**: Rankings based on `acceptingBlockHash.blueScore` + `txid` tiebreaker
- **Provisional vs Final**: Two-stage UX showing real-time status and finality
- **Anti-Bot PoW**: Client-side proof-of-work to increase cost for mass submissions
- **Verifiable Results**: `allocation.json` snapshot with merkle root commit

## Quick Start

### Prerequisites

- Node.js >= 20
- pnpm >= 9
- Docker & Docker Compose

### 1. Clone and Install

```bash
git clone https://github.com/your-org/ghostpass.git
cd ghostpass
pnpm install
```

### 2. Start Infrastructure

```bash
docker compose -f infra/docker-compose.yml up -d
```

### 3. Configure Environment

```bash
cp .env.example .env
# Edit .env with your Kas.fyi API key and other settings
```

### 4. Run Development Servers

```bash
pnpm dev
```

This starts:
- **Web**: http://localhost:3000
- **API**: http://localhost:4001
- **Indexer**: http://localhost:4002

### Health Checks

```bash
curl http://localhost:4001/health
curl http://localhost:4002/health
```

## Project Structure

```
ghostpass/
├── apps/
│   ├── web/        # Next.js frontend
│   ├── api/        # Fastify API server
│   └── indexer/    # Transaction indexer & ordering engine
├── packages/
│   └── shared/     # Shared utilities (payload, PoW, types)
├── infra/
│   └── docker-compose.yml
├── docs/           # Documentation
├── PROJECT.md      # Full specification
└── TICKET.md       # Implementation tickets
```

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────────┐
│   Web App   │────▶│  API Server │────▶│    Database     │
│  (Next.js)  │     │  (Fastify)  │     │  (PostgreSQL)   │
└─────────────┘     └─────────────┘     └─────────────────┘
       │                   │
       │                   │
       ▼                   ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────────┐
│   Wallet    │     │   Indexer   │────▶│  Kaspa Network  │
│  (KasWare)  │────▶│   Engine    │     │  (via Kas.fyi)  │
└─────────────┘     └─────────────┘     └─────────────────┘
```

## License

MIT License - see [LICENSE](LICENSE)
