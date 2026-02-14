# Tickasting Bot Simulator

Stress testing and demo tools for Tickasting fair ticketing system.

## Overview

This simulator demonstrates that Tickasting ordering is **deterministic** even when:
- Multiple bots attack simultaneously
- Network delivers transactions in random order
- Same blockchain data → Same ranking, every time

## Prerequisites

1. Database running (PostgreSQL)
2. API server with Prisma schema applied

```bash
cd apps/api
pnpm db:migrate
```

## Scripts

### 1. Demo Scenario (Recommended for first run)

Complete demo with event creation, bot simulation, and verification:

```bash
cd scripts/bot-sim
pnpm install
pnpm demo -- --count=50 --supply=10
```

Options:
- `--count=N`: Number of bot purchases (default: 50)
- `--supply=N`: Ticket supply (default: 10)
- `--finality=N`: Finality depth (default: 10)

### 2. Simulate Purchases (for existing sale)

Add mock purchases to an existing live sale:

```bash
pnpm sim -- --sale=<saleId> --count=100
```

Options:
- `--sale=UUID`: Sale ID (required)
- `--count=N`: Number of attempts (default: 50)
- `--base-score=N`: Starting blueScore (default: 1000000)
- `--variance=N`: BlueScore spread (default: 100)

### 3. Verify Ordering

Verify that stored ranks match deterministic computation:

```bash
pnpm verify -- --sale=<saleId> --verbose
```

## Demo Recording Guide

For hackathon presentation, follow this script:

### 3-Minute Demo Script

#### Part 1: The Problem (30 seconds)
- Show traditional ticketing: server controls queue
- "Who knows if your rank is real?"

#### Part 2: Live Demo (90 seconds)
1. Terminal: Run demo scenario
   ```bash
   pnpm demo -- --count=100 --supply=20
   ```
2. Highlight key points:
   - "100 bots attacking simultaneously"
   - "Network order is random chaos"
   - "But final ranking is deterministic"

#### Part 3: Verification (30 seconds)
1. Show Results page in browser
2. Point to merkle root
3. "Anyone can verify - no trust required"

#### Part 4: Key Message (30 seconds)
- "Server doesn't create the queue"
- "Blockchain data determines order"
- "Same input → Same output, always"

### Recording Tips

1. **Screen Setup**
   - Terminal on left (full height)
   - Browser on right
   - Dark mode for better visibility

2. **Commands to Prepare**
   ```bash
   # Pre-type these
   pnpm demo -- --count=100 --supply=20
   ```

3. **Browser Tabs Ready**
   - Results page: `http://localhost:3000/sales/{saleId}/results`
   - Live dashboard: `http://localhost:3000/sales/{saleId}/live`

4. **Recording Software**
   - OBS Studio (free)
   - QuickTime (macOS)
   - ScreenRec (Chrome extension)

## Understanding the Output

### Ordering Rules

Winners are ranked by:
1. **Primary**: `acceptingBlockHash.blueScore` (ascending)
2. **Tie-breaker**: `txid` (lexicographic ascending)

### Why This is Fair

- BlueScore comes from Kaspa blockchain (not server)
- Txid is cryptographically random
- Same transactions → Same ordering, always
- No way for server to favor certain users

### Verification

Anyone can verify by:
1. Getting all transactions from treasury address
2. Sorting by (blueScore, txid)
3. Comparing with published results

## Troubleshooting

### "Sale not found"
Ensure the sale exists and is in `live` or `finalizing` status.

### Database connection error
Check `DATABASE_URL` in `.env`:
```
DATABASE_URL="postgresql://postgres:password@localhost:5433/tickasting"
```

### Prisma client not found
Run from the correct directory:
```bash
cd scripts/bot-sim
pnpm install
```
