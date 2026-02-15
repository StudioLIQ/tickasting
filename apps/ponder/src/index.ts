import { ponder } from "ponder:registry";
import {
  salesOnchain,
  ticketTypesOnchain,
  claimsOnchain,
  tokenOwnership,
  paymentTransfersOnchain,
} from "ponder:schema";

// ─── SaleCreated ───
ponder.on("TickastingSale:SaleCreated", async ({ event, context }) => {
  await context.db.insert(salesOnchain).values({
    id: event.args.saleId,
    organizer: event.args.organizer,
    startAt: event.args.startAt,
    endAt: event.args.endAt,
    status: "CREATED",
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
  });
});

// ─── TicketTypeDefined ───
ponder.on("TickastingSale:TicketTypeDefined", async ({ event, context }) => {
  const id = `${event.args.saleId}-${event.args.typeCode}`;

  await context.db.insert(ticketTypesOnchain).values({
    id,
    saleId: event.args.saleId,
    typeCode: event.args.typeCode,
    name: event.args.name,
    supply: event.args.supply,
    priceSompi: event.args.priceSompi,
    claimed: 0n,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
  });
});

// ─── ClaimOpened ───
ponder.on("TickastingSale:ClaimOpened", async ({ event, context }) => {
  await context.db
    .update(salesOnchain, { id: event.args.saleId })
    .set({
      status: "CLAIM_OPEN",
      merkleRoot: event.args.merkleRoot,
    });
});

// ─── TicketClaimed ───
ponder.on("TickastingSale:TicketClaimed", async ({ event, context }) => {
  const claimId = `${event.args.saleId}-${event.args.kaspaTxid}`;
  const typeId = `${event.args.saleId}-${event.args.typeCode}`;

  // Insert claim record
  await context.db
    .insert(claimsOnchain)
    .values({
      id: claimId,
      saleId: event.args.saleId,
      typeCode: event.args.typeCode,
      claimer: event.args.claimer,
      tokenId: event.args.tokenId,
      kaspaTxid: event.args.kaspaTxid,
      finalRank: event.args.finalRank,
      blockNumber: event.block.number,
      blockTimestamp: event.block.timestamp,
      transactionHash: event.transaction.hash,
    })
    .onConflictDoNothing();

  // Update ticket type claimed count
  await context.db
    .update(ticketTypesOnchain, { id: typeId })
    .set((row) => ({
      claimed: row.claimed + 1n,
    }));

  // Upsert token ownership
  await context.db
    .insert(tokenOwnership)
    .values({
      id: event.args.tokenId,
      owner: event.args.claimer,
      typeCode: event.args.typeCode,
      saleId: event.args.saleId,
      blockNumber: event.block.number,
      blockTimestamp: event.block.timestamp,
    })
    .onConflictDoUpdate({
      owner: event.args.claimer,
      blockNumber: event.block.number,
      blockTimestamp: event.block.timestamp,
    });
});

// ─── SaleFinalized ───
ponder.on("TickastingSale:SaleFinalized", async ({ event, context }) => {
  await context.db
    .update(salesOnchain, { id: event.args.saleId })
    .set({
      status: "FINALIZED",
      totalMinted: event.args.totalMinted,
    });
});

// ─── ERC-721 Transfer (track ownership changes) ───
ponder.on("TickastingSale:Transfer", async ({ event, context }) => {
  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

  // Skip mints (handled in TicketClaimed) — from == zero address
  if (event.args.from === ZERO_ADDRESS) return;

  // Track ownership transfer
  await context.db
    .update(tokenOwnership, { id: event.args.tokenId })
    .set({
      owner: event.args.to,
      blockNumber: event.block.number,
      blockTimestamp: event.block.timestamp,
    });
});

// ─── PaymentToken Transfer (USDC purchase attempts) ───
ponder.on("PaymentToken:Transfer", async ({ event, context }) => {
  const logIndex =
    typeof event.log.logIndex === "bigint"
      ? event.log.logIndex
      : BigInt(event.log.logIndex);

  const id = `${event.transaction.hash.toLowerCase()}-${logIndex.toString()}`;
  const tokenAddress = event.log.address.toLowerCase() as `0x${string}`;
  const fromAddress = event.args.from.toLowerCase() as `0x${string}`;
  const toAddress = event.args.to.toLowerCase() as `0x${string}`;
  const txHash = event.transaction.hash.toLowerCase() as `0x${string}`;
  const blockHash = event.block.hash.toLowerCase() as `0x${string}`;

  await context.db
    .insert(paymentTransfersOnchain)
    .values({
      id,
      tokenAddress,
      fromAddress,
      toAddress,
      value: event.args.value,
      txHash,
      blockHash,
      blockNumber: event.block.number,
      blockTimestamp: event.block.timestamp,
      logIndex,
    })
    .onConflictDoNothing();
});
