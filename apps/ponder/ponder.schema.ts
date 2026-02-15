import { index, onchainTable, onchainEnum, relations } from "ponder";

/**
 * Ponder schema for TickastingSale contract events.
 * These tables store on-chain indexed data from Kasplex testnet.
 * The API server reads from these tables for domain logic.
 */

// ─── Enums ───

export const saleOnchainStatus = onchainEnum("sale_onchain_status", [
  "CREATED",
  "CLAIM_OPEN",
  "FINALIZED",
]);

// ─── Tables ───

export const salesOnchain = onchainTable("sales_onchain", (t) => ({
  id: t.hex().primaryKey(),                // saleId (bytes32)
  organizer: t.hex().notNull(),            // organizer address
  startAt: t.bigint().notNull(),           // unix timestamp
  endAt: t.bigint().notNull(),             // unix timestamp
  merkleRoot: t.hex(),                     // set when claim opens
  status: saleOnchainStatus("status").notNull(),
  totalMinted: t.bigint(),                 // set on finalization
  blockNumber: t.bigint().notNull(),       // block where created
  blockTimestamp: t.bigint().notNull(),     // block timestamp
  transactionHash: t.hex().notNull(),      // tx hash
}));

export const ticketTypesOnchain = onchainTable(
  "ticket_types_onchain",
  (t) => ({
    id: t.text().primaryKey(),               // `${saleId}-${typeCode}`
    saleId: t.hex().notNull(),               // FK to salesOnchain
    typeCode: t.hex().notNull(),             // bytes32 type code
    name: t.text().notNull(),                // display name
    supply: t.bigint().notNull(),            // max supply
    priceSompi: t.bigint().notNull(),        // reference price
    claimed: t.bigint().notNull(),           // running claim count
    blockNumber: t.bigint().notNull(),
    blockTimestamp: t.bigint().notNull(),
    transactionHash: t.hex().notNull(),
  }),
  (table) => ({
    saleIdx: index("tt_sale_idx").on(table.saleId),
  }),
);

export const claimsOnchain = onchainTable(
  "claims_onchain",
  (t) => ({
    id: t.text().primaryKey(),               // `${saleId}-${kaspaTxid}`
    saleId: t.hex().notNull(),               // FK to salesOnchain
    typeCode: t.hex().notNull(),             // ticket type code
    claimer: t.hex().notNull(),              // EVM address
    tokenId: t.bigint().notNull(),           // minted token ID
    kaspaTxid: t.hex().notNull(),            // Kaspa purchase txid
    finalRank: t.bigint().notNull(),         // deterministic rank
    blockNumber: t.bigint().notNull(),
    blockTimestamp: t.bigint().notNull(),
    transactionHash: t.hex().notNull(),
  }),
  (table) => ({
    claimerIdx: index("claim_claimer_idx").on(table.claimer),
    saleIdx: index("claim_sale_idx").on(table.saleId),
    kaspaTxidIdx: index("claim_kaspa_txid_idx").on(table.kaspaTxid),
  }),
);

export const tokenOwnership = onchainTable(
  "token_ownership",
  (t) => ({
    id: t.bigint().primaryKey(),             // tokenId
    owner: t.hex().notNull(),                // current owner
    typeCode: t.hex(),                       // ticket type (set on claim)
    saleId: t.hex(),                         // sale reference
    blockNumber: t.bigint().notNull(),
    blockTimestamp: t.bigint().notNull(),
  }),
  (table) => ({
    ownerIdx: index("token_owner_idx").on(table.owner),
  }),
);

export const paymentTransfersOnchain = onchainTable(
  "payment_transfers_onchain",
  (t) => ({
    id: t.text().primaryKey(),                 // `${txHash}-${logIndex}`
    tokenAddress: t.hex().notNull(),           // ERC-20 address
    fromAddress: t.hex().notNull(),            // payer
    toAddress: t.hex().notNull(),              // treasury
    value: t.bigint().notNull(),               // token units (USDC decimals)
    txHash: t.hex().notNull(),
    blockHash: t.hex().notNull(),
    blockNumber: t.bigint().notNull(),
    blockTimestamp: t.bigint().notNull(),
    logIndex: t.bigint().notNull(),
  }),
  (table) => ({
    toIdx: index("pay_to_idx").on(table.toAddress),
    txIdx: index("pay_tx_idx").on(table.txHash),
    blockIdx: index("pay_block_idx").on(table.blockNumber),
  }),
);

// ─── Relations ───

export const salesOnchainRelations = relations(salesOnchain, ({ many }) => ({
  ticketTypes: many(ticketTypesOnchain),
  claims: many(claimsOnchain),
}));

export const ticketTypesOnchainRelations = relations(ticketTypesOnchain, ({ one }) => ({
  sale: one(salesOnchain, {
    fields: [ticketTypesOnchain.saleId],
    references: [salesOnchain.id],
  }),
}));

export const claimsOnchainRelations = relations(claimsOnchain, ({ one }) => ({
  sale: one(salesOnchain, {
    fields: [claimsOnchain.saleId],
    references: [salesOnchain.id],
  }),
}));
