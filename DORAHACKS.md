# Tickasting

> A fair ticketing engine where the chain—not a server—decides the queue.

## One‑liner
A verifiable ticketing system that ranks purchases from on‑chain payment order and publishes auditable results with Merkle proofs.

## Problem
High‑demand ticket drops are still decided by opaque server queues. Outcomes are hard to verify, especially under burst traffic.

## Solution
Tickasting makes ordering public, deterministic, and provable:
- Rank purchases from on‑chain USDC `Transfer` events.
- Publish a winners list plus a Merkle root for verification.
- Stream live queue status over WebSocket.

## Why Kasplex EVM
- Fast confirmations enable real‑time ranking.
- Deterministic ordering from chain data is auditable.
- Standard ERC‑721 claim flow for ticket ownership.

## Key Features
- Deterministic ordering: `blockNumber → logIndex → txHash`.
- Merkle proofs for winners verification.
- Live stats via WebSocket.
- Claim/mint contract for winners (optional for demo).

## Architecture
Next.js (web) + Fastify (API) + Ponder (indexer) + Postgres + Kasplex EVM contract.

## Demo
- Local demo: follow `README.md` (Quick Start + Demo Flow).
- Results verification: `docs/audit.md`.

## Tracks
- Main Track
- Payments & Commerce
- Best UX/UI (Mention)
