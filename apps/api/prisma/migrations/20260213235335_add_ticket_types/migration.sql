-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('scheduled', 'live', 'finalizing', 'finalized');

-- CreateEnum
CREATE TYPE "ValidationStatus" AS ENUM ('pending', 'valid', 'valid_fallback', 'invalid_wrong_amount', 'invalid_missing_payload', 'invalid_pow', 'invalid_bad_payload', 'invalid_wrong_sale');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('issued', 'redeemed', 'cancelled');

-- CreateEnum
CREATE TYPE "ScanResult" AS ENUM ('ok', 'deny_already_redeemed', 'deny_invalid_ticket', 'deny_wrong_event');

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "organizer_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "venue" TEXT,
    "start_at" TIMESTAMP(3),
    "end_at" TIMESTAMP(3),
    "status" "EventStatus" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "network" TEXT NOT NULL DEFAULT 'testnet',
    "treasury_address" TEXT NOT NULL,
    "ticket_price_sompi" BIGINT NOT NULL,
    "supply_total" INTEGER NOT NULL,
    "max_per_address" INTEGER,
    "pow_difficulty" INTEGER NOT NULL DEFAULT 18,
    "finality_depth" INTEGER NOT NULL DEFAULT 30,
    "fallback_enabled" BOOLEAN NOT NULL DEFAULT false,
    "start_at" TIMESTAMP(3),
    "end_at" TIMESTAMP(3),
    "status" "SaleStatus" NOT NULL DEFAULT 'scheduled',
    "merkle_root" TEXT,
    "commit_txid" TEXT,
    "claim_contract_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_types" (
    "id" TEXT NOT NULL,
    "sale_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price_sompi" BIGINT NOT NULL,
    "supply" INTEGER NOT NULL,
    "metadata_uri" TEXT,
    "perk" JSONB,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_attempts" (
    "id" TEXT NOT NULL,
    "sale_id" TEXT NOT NULL,
    "requested_ticket_type_id" TEXT,
    "txid" TEXT NOT NULL,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validation_status" "ValidationStatus" NOT NULL DEFAULT 'pending',
    "invalid_reason" TEXT,
    "payload_hex" TEXT,
    "buyer_addr_hash" TEXT,
    "accepted" BOOLEAN NOT NULL DEFAULT false,
    "accepting_block_hash" TEXT,
    "accepting_blue_score" BIGINT,
    "confirmations" INTEGER NOT NULL DEFAULT 0,
    "provisional_rank" INTEGER,
    "final_rank" INTEGER,
    "last_checked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" TEXT NOT NULL,
    "sale_id" TEXT NOT NULL,
    "ticket_type_id" TEXT,
    "owner_address" TEXT NOT NULL,
    "owner_addr_hash" TEXT NOT NULL,
    "origin_txid" TEXT NOT NULL,
    "claim_txid" TEXT,
    "token_id" TEXT,
    "status" "TicketStatus" NOT NULL DEFAULT 'issued',
    "qr_signature" TEXT,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redeemed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scans" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "scanned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gate_id" TEXT,
    "result" "ScanResult" NOT NULL,
    "operator_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ticket_types_sale_id_idx" ON "ticket_types"("sale_id");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_types_sale_id_code_key" ON "ticket_types"("sale_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_attempts_txid_key" ON "purchase_attempts"("txid");

-- CreateIndex
CREATE INDEX "purchase_attempts_sale_id_idx" ON "purchase_attempts"("sale_id");

-- CreateIndex
CREATE INDEX "purchase_attempts_sale_id_accepted_idx" ON "purchase_attempts"("sale_id", "accepted");

-- CreateIndex
CREATE INDEX "purchase_attempts_sale_id_validation_status_idx" ON "purchase_attempts"("sale_id", "validation_status");

-- CreateIndex
CREATE INDEX "tickets_sale_id_idx" ON "tickets"("sale_id");

-- CreateIndex
CREATE INDEX "tickets_origin_txid_idx" ON "tickets"("origin_txid");

-- CreateIndex
CREATE INDEX "scans_ticket_id_idx" ON "scans"("ticket_id");

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_types" ADD CONSTRAINT "ticket_types_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_attempts" ADD CONSTRAINT "purchase_attempts_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_attempts" ADD CONSTRAINT "purchase_attempts_requested_ticket_type_id_fkey" FOREIGN KEY ("requested_ticket_type_id") REFERENCES "ticket_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_ticket_type_id_fkey" FOREIGN KEY ("ticket_type_id") REFERENCES "ticket_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scans" ADD CONSTRAINT "scans_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
