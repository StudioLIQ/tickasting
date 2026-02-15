# Tickasting Audit & Verification Guide (EVM)

This guide explains how to independently verify a sale result from on-chain data.

## Overview

Tickasting provides three layers of verification:
1. **Deterministic ordering** from payment events
2. **Merkle root** commitment of winners
3. **Optional commit transaction** that records the root on-chain

## 1) Verify Ordering

Ordering rule (EVM mode):
1. `blockNumber` ascending
2. `logIndex` ascending
3. `txHash` ascending

### Data sources
Choose one:
- **Ponder DB**: `payment_transfers_onchain` table
- **RPC**: `eth_getLogs` on the payment token contract

### Steps
1. Collect all USDC `Transfer` logs where `to == treasuryAddress`.
2. Filter to the sale window (between `startAt` and `endAt`, if set).
3. Filter to exact ticket prices (for multi-type sales).
4. Sort with the rule above.
5. The first `supplyTotal` entries are the winners.

## 2) Verify Allocation Snapshot

Fetch the allocation from the API:

```bash
GET /v1/sales/<saleId>/allocation
```

Check:
- `orderingRule` matches the deterministic rule above.
- `winners.length == supplyTotal` (or fewer if not enough valid attempts).
- Winner list matches your independently sorted list.

## 3) Verify Merkle Root (Allocation)

Leaf format used by the API allocation root:

```
sha256(finalRank|txid|blockHash|blockNumber|buyerAddrHash)
```

Notes:
- Use the exact values from `/allocation`.
- `null` values become empty strings.
- In EVM mode, `acceptingBlueScore` is the block number (legacy field name).
- Internal nodes are `sha256(min(a,b) + max(a,b))` (sorted pairs).

Minimal JS example:

```javascript
import crypto from 'crypto'

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex')
}

function hashPair(a, b) {
  const [first, second] = a < b ? [a, b] : [b, a]
  return sha256(first + second)
}

function leafHash(w) {
  const parts = [
    w.finalRank.toString(),
    w.txid,
    w.acceptingBlockHash ?? '',
    w.acceptingBlueScore ?? '',
    w.buyerAddrHash ?? '',
  ]
  return sha256(parts.join('|'))
}

function merkleRoot(winners) {
  if (winners.length === 0) return sha256('EMPTY_TREE')
  let level = winners.map(leafHash)
  while (level.length > 1) {
    const next = []
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]
      const right = i + 1 < level.length ? level[i + 1] : left
      next.push(hashPair(left, right))
    }
    level = next
  }
  return level[0]
}
```

Compare your computed root with `allocation.merkleRoot`.

## 4) Verify Commit Transaction (Optional)

If `allocation.commitTxid` is present, the payload encodes:

```
TKCommit|v1|{saleId}|{merkleRoot}
```

Decode the payload from hex to UTF-8 and compare the `merkleRoot`.

## 5) Claim Proofs (On-chain)

The claim contract uses a different Merkle leaf format.
See `docs/contract-spec.md` for the on-chain proof format and verification rules.
