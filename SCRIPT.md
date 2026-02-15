# Demo Script (TTS)

Tickasting is a fair ticketing engine where the chain, not a central server, decides the queue.

Centralized ticketing relies on private servers, so ordering is opaque and disputes can’t be independently verified. Even if the operator is honest, users still have to trust the system.

Tickasting uses on‑chain payments and deterministic ordering, so anyone can reproduce the winners list. We commit the full set as a Merkle root on‑chain, and each user can verify inclusion with a proof. Results become auditable and tamper‑evident.

Claiming only opens after the sale is finalized and the Merkle root is committed on‑chain. This demo focuses on the live purchase and verification flow, so we stop before the claim phase.

That’s the technical value: fairness from consensus, not from a server—at Kasplex speed.

---

# Technical Implementation (Detailed)

Tickasting’s runtime is split into four layers:

1. Kasplex EVM payments (USDC)
Purchases are standard USDC Transfer events on Kasplex EVM. The transaction ordering (blockNumber → logIndex → txHash) is the canonical queue order.

2. Indexer (Ponder)
Ponder indexes payment and claim events into Postgres. It is reorg‑safe and deterministic, ensuring consistent ordering.

3. API (Fastify)
The API computes winners from indexed chain data. It publishes a full allocation snapshot and Merkle proofs for verification.

4. On‑chain commitment & claim contract
The winners list is hashed into a Merkle root. The root is committed on‑chain, and the contract verifies proofs before minting ticket NFTs on claim.

This architecture makes the result verifiable end‑to‑end: anyone can replay the ordering from chain data, compute the same root, and confirm it matches the on‑chain commitment.
