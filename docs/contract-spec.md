# Tickasting Contract Spec

## Status
- **Finalized**: 2026-02-14
- **Track**: EVM Testnet (Sepolia) — Solidity + Hardhat + ERC-721
- Source of truth for implementation tickets: internal ticket tracker (GP-019 ~ GP-026)

---

## 1. Track Decision

### Selected: **EVM Testnet (Sepolia)**

| Criterion | Kaspa Native/KRC | EVM (Sepolia) | Decision |
|---|---|---|---|
| Smart contract VM | Not available on Kaspa L1 | Full Solidity support | EVM |
| Token standard | KRC-20 (inscription), KRC-721 (unofficial) | ERC-721 (mature) | EVM |
| Tooling | Minimal | Hardhat/Foundry, OpenZeppelin, ethers.js | EVM |
| Testnet faucets | Available | Available (free) | Tie |
| Hackathon alignment | Kaspa hackathon (ideal) | Cross-chain hybrid | Trade-off |

### Rationale
- Kaspa currently has no general-purpose smart contract VM for enforcing claim/mint logic on-chain.
- EVM (Sepolia) provides battle-tested tooling: Solidity, Hardhat, OpenZeppelin, ERC-721.
- **Hybrid architecture**: Kaspa handles payment + fair ordering (the core innovation), EVM handles ownership finalization (standard NFT pattern).
- The hybrid approach actually strengthens the Kaspa value proposition: "Kaspa for fairness, EVM for ownership."

### ASSUMPTIONS
- Sepolia testnet will remain stable for hackathon duration.
- Users will have a MetaMask-compatible wallet for claim (separate from KasWare).
- Future migration to Kaspa-native contracts is possible when Kaspa adds smart contract support (interface abstraction).

---

## 2. Architecture: Off-chain Engine vs Contract Boundary

```
┌─────────────────────────────────────────────────────┐
│                   OFF-CHAIN ENGINE                   │
│  (Kaspa payment + deterministic ordering)            │
│                                                      │
│  Responsibilities:                                   │
│  - Detect purchase tx on Kaspa                       │
│  - Validate payload/PoW/amount                       │
│  - Track acceptance + confirmations                  │
│  - Compute deterministic rank (blueScore + txid)     │
│  - Determine winners (rank <= supply)                │
│  - Generate Merkle tree of winners                   │
│  - Publish allocation.json                           │
└──────────────────────┬──────────────────────────────┘
                       │ merkleRoot + winner proofs
                       ▼
┌─────────────────────────────────────────────────────┐
│                   ON-CHAIN CONTRACT                  │
│  (EVM / Sepolia — ERC-721)                          │
│                                                      │
│  Responsibilities:                                   │
│  - Register sale + ticket types (supply caps)        │
│  - Store Merkle root (winner set commitment)         │
│  - Verify Merkle proof on claim                      │
│  - Mint ERC-721 ticket NFT per type                  │
│  - Enforce: no duplicate claim, no supply overflow   │
│  - Emit events for indexing                          │
└─────────────────────────────────────────────────────┘
```

---

## 3. Contract Interface (Solidity ABI)

### 3.1 Contract Name: `TickastingSale`

Inherits: `ERC721Enumerable`, `Ownable`, `ReentrancyGuard`

### 3.2 Structs

```solidity
struct TicketType {
    bytes32 code;          // e.g. keccak256("VIP"), keccak256("GEN")
    string  name;          // display name
    uint256 priceSompi;    // reference price (informational, not enforced on EVM)
    uint256 supply;        // max mintable
    uint256 minted;        // current minted count
    string  metadataUri;   // base URI for this type
    bool    active;        // can be claimed
}

struct ClaimData {
    address claimer;       // EVM address of the winner
    bytes32 ticketTypeCode;// which type they won
    bytes32 kaspaTxid;     // Kaspa purchase txid (cross-chain reference)
    uint256 finalRank;     // deterministic rank from off-chain engine
}
```

### 3.3 State Variables

```solidity
bytes32 public saleId;                           // UUID as bytes32
address public organizer;                        // sale organizer
uint256 public startAt;                          // sale start (unix)
uint256 public endAt;                            // sale end (unix)
bytes32 public merkleRoot;                       // winner set commitment
bool    public claimOpen;                        // claim phase active
bool    public finalized;                        // sale finalized

mapping(bytes32 => TicketType) public ticketTypes;  // code => type
bytes32[] public ticketTypeCodes;                   // ordered list

mapping(bytes32 => bool) public claimed;         // kaspaTxid => already claimed
mapping(uint256 => bytes32) public tokenType;    // tokenId => ticketTypeCode
uint256 public nextTokenId;                      // auto-increment
```

### 3.4 Functions

```solidity
// ─── Admin (onlyOwner / onlyOrganizer) ───

/// @notice Initialize the sale
function createSale(
    bytes32 _saleId,
    address _organizer,
    uint256 _startAt,
    uint256 _endAt
) external onlyOwner;

/// @notice Register a ticket type with supply cap
function defineTicketType(
    bytes32 _code,
    string calldata _name,
    uint256 _priceSompi,
    uint256 _supply,
    string calldata _metadataUri
) external onlyOrganizer;

/// @notice Commit the Merkle root and open claims
function openClaim(
    bytes32 _merkleRoot
) external onlyOrganizer;

/// @notice Close the sale permanently
function finalizeSale() external onlyOrganizer;

// ─── Public (winner) ───

/// @notice Claim a ticket by providing a Merkle proof
/// @param _ticketTypeCode The ticket type to claim
/// @param _kaspaTxid The Kaspa purchase txid
/// @param _finalRank The winner's final rank
/// @param _merkleProof The Merkle proof path
function claimTicket(
    bytes32 _ticketTypeCode,
    bytes32 _kaspaTxid,
    uint256 _finalRank,
    bytes32[] calldata _merkleProof
) external nonReentrant;

// ─── View ───

function getTicketType(bytes32 _code) external view returns (TicketType memory);
function getTicketTypeCodes() external view returns (bytes32[] memory);
function getRemainingSupply(bytes32 _code) external view returns (uint256);
function isClaimed(bytes32 _kaspaTxid) external view returns (bool);
function getTokenTicketType(uint256 _tokenId) external view returns (bytes32);
```

---

## 4. Events

```solidity
event SaleCreated(
    bytes32 indexed saleId,
    address indexed organizer,
    uint256 startAt,
    uint256 endAt
);

event TicketTypeDefined(
    bytes32 indexed saleId,
    bytes32 indexed typeCode,
    string name,
    uint256 supply,
    uint256 priceSompi
);

event ClaimOpened(
    bytes32 indexed saleId,
    bytes32 merkleRoot
);

event TicketClaimed(
    bytes32 indexed saleId,
    bytes32 indexed typeCode,
    address indexed claimer,
    uint256 tokenId,
    bytes32 kaspaTxid,
    uint256 finalRank
);

event SaleFinalized(
    bytes32 indexed saleId,
    uint256 totalMinted
);
```

---

## 5. Merkle Proof Format

### 5.1 Leaf Construction

Each winner entry is hashed as:

```solidity
bytes32 leaf = keccak256(abi.encodePacked(
    claimer,          // address (EVM)
    ticketTypeCode,   // bytes32
    kaspaTxid,        // bytes32
    finalRank         // uint256
));
```

### 5.2 Tree Construction
- Standard binary Merkle tree (sorted pairs).
- Use `keccak256` for internal nodes: `keccak256(abi.encodePacked(min(a,b), max(a,b)))`.
- This matches OpenZeppelin's `MerkleProof.verify()`.

### 5.3 Proof Verification (on-chain)

```solidity
function _verifyProof(
    address _claimer,
    bytes32 _ticketTypeCode,
    bytes32 _kaspaTxid,
    uint256 _finalRank,
    bytes32[] calldata _proof
) internal view returns (bool) {
    bytes32 leaf = keccak256(abi.encodePacked(
        _claimer, _ticketTypeCode, _kaspaTxid, _finalRank
    ));
    return MerkleProof.verify(_proof, merkleRoot, leaf);
}
```

---

## 6. Invariants (Contract-Enforced)

1. **Supply cap**: `ticketType.minted < ticketType.supply` — revert if exceeded.
2. **No duplicate claim**: `claimed[kaspaTxid] == false` — revert if already claimed.
3. **Valid proof**: Merkle proof must verify against committed `merkleRoot`.
4. **Claim phase**: `claimOpen == true && finalized == false`.
5. **Active type**: `ticketType.active == true`.

---

## 7. Access Control

| Role | Can Do |
|---|---|
| Owner (deployer) | `createSale` |
| Organizer | `defineTicketType`, `openClaim`, `finalizeSale` |
| Winner (any address) | `claimTicket` (with valid proof) |

- `onlyOrganizer` modifier checks `msg.sender == organizer`.
- Owner can transfer organizer role (optional admin function).

---

## 8. Deployment Configuration

### Environment Variables
```
# Contract deployment
CONTRACT_NETWORK=sepolia
CONTRACT_RPC_URL=https://sepolia.infura.io/v3/<key>
DEPLOYER_PRIVATE_KEY=<deployer-private-key>
ETHERSCAN_API_KEY=<for-verification>

# Deployed contract address (after deployment)
TICKASTING_CONTRACT_ADDRESS=0x...
```

### Deployment Steps
1. `npx hardhat compile`
2. `npx hardhat test`
3. `npx hardhat run scripts/deploy.ts --network sepolia`
4. Record contract address in `.env`
5. `npx hardhat verify --network sepolia <address>`

---

## 9. Naming Conventions

| Item | Convention | Example |
|---|---|---|
| Contract file | PascalCase | `TickastingSale.sol` |
| Struct fields | camelCase | `priceSompi` |
| Events | PascalCase | `TicketClaimed` |
| Function names | camelCase | `claimTicket` |
| Constants | UPPER_SNAKE | `MAX_TICKET_TYPES` |
| Ticket type codes | bytes32 hash | `keccak256("VIP")` |

---

## 10. Integration Flow (End-to-End)

```
1. Organizer creates sale on API (Kaspa treasury address)
2. Organizer deploys TickastingSale contract on Sepolia
3. Organizer calls createSale() + defineTicketType() on contract
4. Sale goes live — buyers send KAS to treasury
5. Off-chain engine computes deterministic ranking
6. Sale ends — engine generates allocation + Merkle tree
7. Organizer calls openClaim(merkleRoot) on contract
8. Winners connect MetaMask, call claimTicket() with proof
9. Contract verifies proof, mints ERC-721
10. Organizer calls finalizeSale() to close
```

---

## 11. ABI Export

The compiled ABI will be exported from `contracts/` to `packages/shared/abi/` for use by:
- `apps/api` — event indexing, read calls
- `apps/web` — ethers.js contract interactions
- `apps/ponder` — event indexing (future)

File: `packages/shared/abi/TickastingSale.json`

---

## 12. Future: Kaspa-Native Migration

When Kaspa adds smart contract support:
- The `TickastingSale` interface can be re-implemented natively.
- The off-chain engine remains unchanged.
- Only the contract deployment target and wallet integration change.
- The interface abstraction in `packages/shared` ensures this migration is minimal.
