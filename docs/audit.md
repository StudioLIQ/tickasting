# Tickasting Audit & Verification Guide

This document explains how to independently verify Tickasting sale results.

## Overview

Tickasting uses three layers of verification:
1. **Deterministic Ordering** - Results are computed from on-chain data
2. **Merkle Root** - Cryptographic commitment of all winners
3. **Commit Transaction** - Merkle root recorded on Kaspa blockchain

## 1. Verify Ordering Rules

Winners are ranked using this deterministic rule:

| Priority | Field | Direction |
|----------|-------|-----------|
| 1 (Primary) | `acceptingBlockHash.blueScore` | Ascending |
| 2 (Tie-breaker) | `txid` | Lexicographic Ascending |

### Steps to Verify

1. Get all purchase transactions from the treasury address
2. Filter to valid, accepted transactions with confirmations >= finality_depth
3. Sort by (blueScore ASC, txid ASC)
4. First N = `supply_total` are winners

### Using kas.fyi API

```bash
# Get transactions for treasury address
curl "https://api.kas.fyi/addresses/{treasury_address}/transactions"

# Get transaction details (including acceptingBlockHash)
curl "https://api.kas.fyi/transactions/{txid}"

# Get block details (for blueScore)
curl "https://api.kas.fyi/blocks/{acceptingBlockHash}"
```

## 2. Verify Merkle Root

The merkle root is computed from the winners list:

### Leaf Hash Format

Each winner generates a leaf hash:
```
leaf = sha256(finalRank|txid|acceptingBlockHash|acceptingBlueScore|buyerAddrHash)
```

### Tree Construction

1. Compute leaf hash for each winner
2. Pair leaves and hash together (sorted order for consistency)
3. Repeat until single root remains
4. Odd nodes are paired with themselves

### Verification Code (JavaScript)

```javascript
import crypto from 'crypto'

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex')
}

function hashPair(a, b) {
  const [first, second] = a < b ? [a, b] : [b, a]
  return sha256(first + second)
}

function computeLeafHash(winner) {
  const data = [
    winner.finalRank.toString(),
    winner.txid,
    winner.acceptingBlockHash ?? '',
    winner.acceptingBlueScore ?? '',
    winner.buyerAddrHash ?? '',
  ].join('|')
  return sha256(data)
}

function computeMerkleRoot(winners) {
  if (winners.length === 0) return sha256('EMPTY_TREE')

  let leaves = winners.map(computeLeafHash)

  while (leaves.length > 1) {
    const next = []
    for (let i = 0; i < leaves.length; i += 2) {
      if (i + 1 < leaves.length) {
        next.push(hashPair(leaves[i], leaves[i + 1]))
      } else {
        next.push(hashPair(leaves[i], leaves[i]))
      }
    }
    leaves = next
  }

  return leaves[0]
}
```

## 3. Verify Commit Transaction

The commit transaction contains the merkle root in its payload.

### Payload Format

```
TKCommit|v1|{saleId}|{merkleRoot}
```

Encoded as hex in the transaction payload.

### Steps to Verify

1. Get the commit transaction from the blockchain:
   ```bash
   curl "https://api.kas.fyi/transactions/{commitTxid}"
   ```

2. Decode the payload from hex to UTF-8

3. Parse the payload and extract the merkle root

4. Compare with your independently computed merkle root

### Verification Code

```javascript
function parseCommitPayload(payloadHex) {
  const payload = Buffer.from(payloadHex, 'hex').toString('utf-8')
  const parts = payload.split('|')

  if (parts.length !== 4 || parts[0] !== 'TKCommit' || parts[1] !== 'v1') {
    return null
  }

  return {
    saleId: parts[2],
    merkleRoot: parts[3],
  }
}
```

## 4. Verify Individual Winner

To verify a specific transaction is a winner:

### API Endpoint

```bash
GET /v1/sales/{saleId}/merkle-proof?txid={txid}
```

### Response Format

```json
{
  "found": true,
  "txid": "...",
  "finalRank": 1,
  "leaf": {
    "finalRank": 1,
    "txid": "...",
    "acceptingBlockHash": "...",
    "acceptingBlueScore": "1000",
    "buyerAddrHash": "..."
  },
  "proof": [
    { "hash": "...", "position": "right" },
    { "hash": "...", "position": "left" }
  ],
  "merkleRoot": "...",
  "commitTxid": "..."
}
```

### Verification Steps

1. Compute the leaf hash from the leaf data
2. Apply each proof step:
   - If position is "left": hash = sha256(sorted(proofHash, currentHash))
   - If position is "right": hash = sha256(sorted(currentHash, proofHash))
3. Final hash should equal the merkle root

## 5. Complete Verification Checklist

- [ ] Download `allocation.json` from the results page
- [ ] Verify all winner transactions exist on-chain
- [ ] Verify each transaction has correct amount to treasury
- [ ] Verify ordering matches deterministic rules
- [ ] Compute merkle root from winners list
- [ ] Compare computed root with allocation.json merkleRoot
- [ ] Find commit transaction on kas.fyi
- [ ] Verify commit tx payload contains matching merkle root
- [ ] Verify commit tx timestamp is after sale end

## 6. Trust Model

| Component | Trust Requirement |
|-----------|-------------------|
| Kaspa Blockchain | Decentralized consensus |
| kas.fyi API | Trusted data source (or use own node) |
| Tickasting Server | Zero trust - results are verifiable |
| Merkle Commit | Immutable on-chain record |

## 7. Common Issues

### Q: Why does my computed merkle root differ?

- Check winner ordering matches exactly (blueScore, then txid)
- Verify you're using the same finality_depth
- Ensure all fields are in the correct format

### Q: How do I verify without trusting Tickasting?

1. Run your own Kaspa node
2. Query treasury address transactions directly
3. Apply ordering rules yourself
4. Compute merkle root independently
5. Verify against on-chain commit transaction

### Q: Can Tickasting manipulate results?

No. The ordering rules are deterministic and based on on-chain data. The merkle root is committed to the blockchain before results can be changed. Any manipulation would produce a different merkle root that wouldn't match the on-chain commitment.
