# GhostPass Payload Format v1

## Overview

The GhostPass payload is embedded in Kaspa transaction's payload field to identify purchase attempts and carry PoW proof.

## Binary Format

Total: **59 bytes** (118 hex characters)

| Offset | Field          | Size   | Type      | Description                              |
|--------|----------------|--------|-----------|------------------------------------------|
| 0      | magic          | 4      | string    | `"GPS1"` (ASCII)                         |
| 4      | version        | 1      | uint8     | `0x01` for v1                            |
| 5      | saleId         | 16     | bytes     | UUIDv4 as raw bytes                      |
| 21     | buyerAddrHash  | 20     | bytes     | First 20 bytes of SHA-256(kaspa_address) |
| 41     | clientTimeMs   | 8      | uint64 BE | Client timestamp in milliseconds         |
| 49     | powAlgo        | 1      | uint8     | `0x01` = SHA-256                         |
| 50     | powDifficulty  | 1      | uint8     | Number of leading zero bits required     |
| 51     | powNonce       | 8      | uint64 BE | PoW solution nonce                       |

## Example

### Input Values

```json
{
  "magic": "GPS1",
  "version": 1,
  "saleId": "550e8400-e29b-41d4-a716-446655440000",
  "buyerAddrHash": "0123456789abcdef0123456789abcdef01234567",
  "clientTimeMs": 1706800000000,
  "powAlgo": 1,
  "powDifficulty": 18,
  "powNonce": 123456789
}
```

### Encoded (hex)

```
47505331015505e840009e2b41d4a7164466554400000123456789abcdef0123456789abcdef01234567000001700c848e8000011200000000075bcd15
```

### Breakdown

```
47505331             # magic: "GPS1"
01                   # version: 1
550e8400e29b41d4a716446655440000  # saleId (UUID bytes)
0123456789abcdef0123456789abcdef01234567  # buyerAddrHash (20 bytes)
000001700c848e80     # clientTimeMs: 1706800000000
01                   # powAlgo: SHA-256
12                   # powDifficulty: 18
00000000075bcd15     # powNonce: 123456789
```

## PoW Verification

The PoW puzzle is verified as follows:

1. Build message: `"GhostPassPoW|v1|{saleId}|{buyerAddrHash}|{nonce}"`
2. Compute: `hash = SHA-256(message)`
3. Verify: leading zero bits of `hash` >= `powDifficulty`

### Example

```
message = "GhostPassPoW|v1|550e8400-e29b-41d4-a716-446655440000|0123456789abcdef0123456789abcdef01234567|123456789"
hash = SHA-256(message)
# If hash starts with at least `difficulty` zero bits, PoW is valid
```

## Difficulty Guidelines

| Difficulty | Expected Hashes | Approx. Time (Desktop) |
|------------|-----------------|------------------------|
| 8          | 256             | instant                |
| 16         | 65,536          | ~0.1s                  |
| 18         | 262,144         | ~0.5s                  |
| 20         | 1,048,576       | ~1-2s                  |
| 24         | 16,777,216      | ~5-20s                 |

## Implementation

See `@ghostpass/shared` package:

- `encodePayload(payload)` - Encode to hex string
- `decodePayload(hex)` - Decode and validate
- `solvePow(input)` - Find valid nonce
- `verifyPow(input, nonce)` - Verify solution
