# Tickasting

> A fair ticketing engine where the chain—not the server—decides the queue.

## One‑liner
A verifiable ticketing system that uses on‑chain payment ordering to produce auditable results and proof‑based claims.

## The Problem
High‑demand ticket drops are still decided by opaque server queues. That creates distrust, disputes, and support burden when outcomes can’t be independently verified—especially under real‑time load.

## The Solution
Tickasting makes the ordering public, deterministic, and provable.
- Rank purchases directly from on‑chain transaction order.
- Commit the full winners list as a Merkle root; let anyone verify with individual proofs.
- Stream live queue status so users see the outcome in real time.

## Why Kaspa / Kasplex
- Fast confirmations and high throughput make real‑time ticketing feasible.
- On‑chain ordering becomes the single source of truth.
- Kasplex EVM lets us finalize ownership and claims on‑chain with familiar tooling.

## Kaspa Integration (Implemented)
- Kasplex EVM USDC `Transfer` events are the payment source and ordering input.
- `TickastingSale` contract verifies Merkle proofs and mints tickets on claim.
- Merkle root + commit transaction are recorded on‑chain (Kasplex EVM).

## Market Fit & Viability
- Fairness and transparency are now table‑stakes for major ticket drops.
- Organizers and platforms can reduce disputes and support costs by publishing verifiable results.
- The system is modular: it can plug into existing ticketing flows while preserving on‑chain auditability.

## Key Features
- Deterministic ranking: `blockNumber` → `logIndex` → `txHash`.
- Tamper‑proof results via Merkle root + proofs.
- Live queue, remaining supply, and results via WebSocket.
- Public APIs for allocation and verification.

## Architecture
Next.js (web) + Fastify (API) + Ponder (indexer) + Postgres + Kasplex EVM contract.

## Demo
- Live demo: (TBD)
- Demo video (<=3 min): (TBD)
- Screenshot: (TBD)

## Setup
See `README.md` for local setup and demo flow.

## Tracks
- Main Track
- Payments & Commerce
- Best UX/UI (Mention)
