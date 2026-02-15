# Tickasting Contract Spec

## Status
- **Finalized**: 2026-02-15
- **Track**: Kasplex EVM Testnet (chainId 167012)
- **Stack**: Solidity + Hardhat + ERC-721

---

## 1. Scope

The off-chain engine computes winners and a Merkle root. The on-chain contract verifies claims and mints tickets.

## 2. Off-chain vs On-chain Boundary

Off-chain (API + Ponder):
- Index USDC `Transfer` events.
- Compute deterministic ordering and winners.
- Build Merkle tree from winners.

On-chain (TickastingSale):
- Register ticket types and supply caps.
- Store Merkle root and open claims.
- Verify Merkle proofs.
- Mint ERC-721 tickets.

---

## 3. Contract: `TickastingSale`

Inherits: `ERC721Enumerable`, `Ownable`, `ReentrancyGuard`

### 3.1 State

```solidity
bytes32 public saleId;
address public organizer;
uint256 public startAt;
uint256 public endAt;
bytes32 public merkleRoot;
bool    public claimOpen;
bool    public finalized;

mapping(bytes32 => TicketType) public ticketTypes;
bytes32[] public ticketTypeCodes;

mapping(bytes32 => bool) public claimed; // payment txid => claimed
mapping(uint256 => bytes32) public tokenType; // tokenId => typeCode
uint256 public nextTokenId;
```

### 3.2 Admin Functions

```solidity
function createSale(bytes32 saleId, address organizer, uint256 startAt, uint256 endAt) external onlyOwner;
function defineTicketType(bytes32 code, string name, uint256 priceSompi, uint256 supply, string metadataUri) external onlyOrganizer;
function openClaim(bytes32 merkleRoot) external onlyOrganizer;
function finalizeSale() external onlyOrganizer;
```

### 3.3 Public Claim

```solidity
function claimTicket(
  bytes32 ticketTypeCode,
  bytes32 paymentTxid,
  uint256 finalRank,
  bytes32[] calldata merkleProof
) external nonReentrant;
```

`paymentTxid` is the off-chain payment transaction hash used in the winner set.

### 3.4 View Functions

```solidity
function getTicketType(bytes32 code) external view returns (TicketType memory);
function getTicketTypeCodes() external view returns (bytes32[] memory);
function getRemainingSupply(bytes32 code) external view returns (uint256);
function isClaimed(bytes32 paymentTxid) external view returns (bool);
function getTokenTicketType(uint256 tokenId) external view returns (bytes32);
```

---

## 4. Events

```solidity
event SaleCreated(bytes32 indexed saleId, address indexed organizer, uint256 startAt, uint256 endAt);
event TicketTypeDefined(bytes32 indexed saleId, bytes32 indexed typeCode, string name, uint256 supply, uint256 priceSompi);
event ClaimOpened(bytes32 indexed saleId, bytes32 merkleRoot);
event TicketClaimed(bytes32 indexed saleId, bytes32 indexed typeCode, address indexed claimer, uint256 tokenId, bytes32 paymentTxid, uint256 finalRank);
event SaleFinalized(bytes32 indexed saleId, uint256 totalMinted);
```

---

## 5. Merkle Proof Format

Leaf hash:

```solidity
bytes32 leaf = keccak256(abi.encodePacked(
  claimer,
  ticketTypeCode,
  paymentTxid,
  finalRank
));
```

Tree construction:
- Sorted pairs (`min(a,b)`, `max(a,b)`)
- Internal nodes hashed with `keccak256`
- Matches OpenZeppelin `MerkleProof.verify()`

---

## 6. Invariants

1. Supply cap enforced per ticket type.
2. No duplicate claim per `paymentTxid`.
3. Claim must be open and sale not finalized.
4. Merkle proof must verify against `merkleRoot`.
5. Ticket type must be active.

---

## 7. Deployment

Environment variables:

```dotenv
CONTRACT_RPC_URL=https://rpc.kasplextest.xyz
DEPLOYER_PRIVATE_KEY=<private-key>
```

Commands:

```bash
pnpm --filter @tickasting/contracts compile
pnpm --filter @tickasting/contracts test
pnpm --filter @tickasting/contracts deploy:kasplex-testnet
pnpm --filter @tickasting/contracts export-abi
```

Record the deployed address in `TICKASTING_CONTRACT_ADDRESS` for API, Ponder, and Web.
