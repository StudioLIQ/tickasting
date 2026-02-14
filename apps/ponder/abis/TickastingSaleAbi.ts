export const TickastingSaleAbi = [
  // ─── Events ───
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "bytes32", name: "saleId", type: "bytes32" },
      { indexed: true, internalType: "address", name: "organizer", type: "address" },
      { indexed: false, internalType: "uint256", name: "startAt", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "endAt", type: "uint256" },
    ],
    name: "SaleCreated",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "bytes32", name: "saleId", type: "bytes32" },
      { indexed: true, internalType: "bytes32", name: "typeCode", type: "bytes32" },
      { indexed: false, internalType: "string", name: "name", type: "string" },
      { indexed: false, internalType: "uint256", name: "supply", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "priceSompi", type: "uint256" },
    ],
    name: "TicketTypeDefined",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "bytes32", name: "saleId", type: "bytes32" },
      { indexed: false, internalType: "bytes32", name: "merkleRoot", type: "bytes32" },
    ],
    name: "ClaimOpened",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "bytes32", name: "saleId", type: "bytes32" },
      { indexed: true, internalType: "bytes32", name: "typeCode", type: "bytes32" },
      { indexed: true, internalType: "address", name: "claimer", type: "address" },
      { indexed: false, internalType: "uint256", name: "tokenId", type: "uint256" },
      { indexed: false, internalType: "bytes32", name: "kaspaTxid", type: "bytes32" },
      { indexed: false, internalType: "uint256", name: "finalRank", type: "uint256" },
    ],
    name: "TicketClaimed",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "bytes32", name: "saleId", type: "bytes32" },
      { indexed: false, internalType: "uint256", name: "totalMinted", type: "uint256" },
    ],
    name: "SaleFinalized",
    type: "event",
  },
  // ─── ERC-721 Transfer ───
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "from", type: "address" },
      { indexed: true, internalType: "address", name: "to", type: "address" },
      { indexed: true, internalType: "uint256", name: "tokenId", type: "uint256" },
    ],
    name: "Transfer",
    type: "event",
  },
  // ─── View Functions (for contract reads in handlers) ───
  {
    inputs: [{ internalType: "bytes32", name: "_code", type: "bytes32" }],
    name: "getTicketType",
    outputs: [
      {
        components: [
          { internalType: "bytes32", name: "code", type: "bytes32" },
          { internalType: "string", name: "name", type: "string" },
          { internalType: "uint256", name: "priceSompi", type: "uint256" },
          { internalType: "uint256", name: "supply", type: "uint256" },
          { internalType: "uint256", name: "minted", type: "uint256" },
          { internalType: "string", name: "metadataUri", type: "string" },
          { internalType: "bool", name: "active", type: "bool" },
        ],
        internalType: "struct TickastingSale.TicketType",
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "bytes32", name: "_code", type: "bytes32" }],
    name: "getRemainingSupply",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "saleId",
    outputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "merkleRoot",
    outputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalSupply",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;
