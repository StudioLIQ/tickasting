import { PrismaClient } from '@prisma/client'
import { createHash, createHmac } from 'crypto'

const prisma = new PrismaClient()
const demoTreasuryAddress =
  process.env['DEMO_TREASURY_ADDRESS'] ||
  process.env['DEPLOYER_ADDRESS'] ||
  '0xdeCBa1c1b410458A07adAC185Ab774B716B4e7a3'
const demoClaimContractAddress = process.env['TICKASTING_CONTRACT_ADDRESS'] || null
const ticketSecret = process.env['TICKET_SECRET'] || 'dev-ticket-secret-change-in-prod'

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

function signTicketData(ticketId: string, saleId: string, txid: string): string {
  const message = `${ticketId}|${saleId}|${txid}`
  return createHmac('sha256', ticketSecret).update(message).digest('hex')
}

async function main() {
  console.log('Seeding database...')
  const now = new Date()
  const saleStart = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const saleEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

  // Create sample event
  const event = await prisma.event.upsert({
    where: { id: 'demo-event-001' },
    update: {},
    create: {
      id: 'demo-event-001',
      organizerId: 'demo-organizer',
      title: 'Tickasting Demo Concert',
      venue: 'Kaspa Arena',
      startAt: new Date('2025-03-01T19:00:00Z'),
      endAt: new Date('2025-03-01T23:00:00Z'),
      status: 'published',
    },
  })

  console.log(`Created event: ${event.title}`)

  // Create sample sale
  const sale = await prisma.sale.upsert({
    where: { id: 'demo-sale-001' },
    update: {
      network: 'kasplex-testnet',
      treasuryAddress: demoTreasuryAddress,
      ticketPriceSompi: BigInt(1_000_000), // 1 USDC (6 decimals)
      finalityDepth: 12,
      startAt: saleStart,
      endAt: saleEnd,
      status: 'live',
      claimContractAddress: demoClaimContractAddress,
    },
    create: {
      id: 'demo-sale-001',
      eventId: event.id,
      network: 'kasplex-testnet',
      treasuryAddress: demoTreasuryAddress,
      ticketPriceSompi: BigInt(1_000_000), // 1 USDC (6 decimals)
      supplyTotal: 100,
      maxPerAddress: 2,
      powDifficulty: 18,
      finalityDepth: 12,
      startAt: saleStart,
      endAt: saleEnd,
      status: 'live',
      claimContractAddress: demoClaimContractAddress,
    },
  })

  console.log(`Created sale: ${sale.id} for event ${event.title}`)
  console.log(`  - Treasury: ${sale.treasuryAddress}`)
  console.log(`  - Price: ${sale.ticketPriceSompi} (USDC smallest unit, 6 decimals)`)
  console.log(`  - Supply: ${sale.supplyTotal}`)
  console.log(`  - Finality Depth: ${sale.finalityDepth}`)
  if (sale.claimContractAddress) {
    console.log(`  - Claim Contract: ${sale.claimContractAddress}`)
  }

  // Create ticket types (VIP / Reserved / General)
  const ticketTypes = [
    {
      id: 'demo-type-vip',
      saleId: sale.id,
      code: 'VIP',
      name: 'VIP Standing',
      priceSompi: BigInt(5_000_000), // 5 USDC
      supply: 10,
      metadataUri: 'ipfs://demo/vip',
      perk: { backstageAccess: true, merchandiseIncluded: true },
      sortOrder: 0,
    },
    {
      id: 'demo-type-r',
      saleId: sale.id,
      code: 'R',
      name: 'Reserved Seat',
      priceSompi: BigInt(2_000_000), // 2 USDC
      supply: 40,
      metadataUri: 'ipfs://demo/reserved',
      perk: { seatSection: 'A-D' },
      sortOrder: 1,
    },
    {
      id: 'demo-type-gen',
      saleId: sale.id,
      code: 'GEN',
      name: 'General Admission',
      priceSompi: BigInt(1_000_000), // 1 USDC
      supply: 50,
      metadataUri: 'ipfs://demo/general',
      perk: null,
      sortOrder: 2,
    },
  ]

  for (const tt of ticketTypes) {
    await prisma.ticketType.upsert({
      where: { id: tt.id },
      update: {
        priceSompi: tt.priceSompi,
        supply: tt.supply,
        metadataUri: tt.metadataUri,
        perk: tt.perk ?? undefined,
      },
      create: tt,
    })
    console.log(
      `  - Ticket type: ${tt.code} (${tt.name}) — supply: ${tt.supply}, price: ${tt.priceSompi} (USDC unit)`
    )
  }

  const ticketTypeByCode = new Map(ticketTypes.map((tt) => [tt.code, tt.id]))

  const sampleAttempts = [
    {
      txid: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1',
      requestedTypeCode: 'VIP',
      buyerAddrHash: sha256Hex('demo-buyer-1'),
      validationStatus: 'valid' as const,
      accepted: true,
      acceptingBlockHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb01',
      acceptingBlueScore: BigInt(1200001),
      confirmations: 24,
      provisionalRank: 1,
      finalRank: 1,
    },
    {
      txid: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2',
      requestedTypeCode: 'R',
      buyerAddrHash: sha256Hex('demo-buyer-2'),
      validationStatus: 'valid' as const,
      accepted: true,
      acceptingBlockHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb02',
      acceptingBlueScore: BigInt(1200002),
      confirmations: 23,
      provisionalRank: 2,
      finalRank: 2,
    },
    {
      txid: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3',
      requestedTypeCode: 'GEN',
      buyerAddrHash: sha256Hex('demo-buyer-3'),
      validationStatus: 'valid' as const,
      accepted: true,
      acceptingBlockHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb03',
      acceptingBlueScore: BigInt(1200003),
      confirmations: 22,
      provisionalRank: 3,
      finalRank: 3,
    },
    {
      txid: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa4',
      requestedTypeCode: 'GEN',
      buyerAddrHash: sha256Hex('demo-buyer-4'),
      validationStatus: 'valid' as const,
      accepted: true,
      acceptingBlockHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb04',
      acceptingBlueScore: BigInt(1200004),
      confirmations: 18,
      provisionalRank: 4,
      finalRank: 4,
    },
    {
      txid: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa5',
      requestedTypeCode: 'R',
      buyerAddrHash: sha256Hex('demo-buyer-5'),
      validationStatus: 'invalid_pow' as const,
      accepted: false,
      acceptingBlockHash: null,
      acceptingBlueScore: null,
      confirmations: 4,
      provisionalRank: null,
      finalRank: null,
    },
  ]

  for (const attempt of sampleAttempts) {
    await prisma.purchaseAttempt.upsert({
      where: { txid: attempt.txid },
      update: {
        saleId: sale.id,
        requestedTicketTypeId: ticketTypeByCode.get(attempt.requestedTypeCode) ?? null,
        buyerAddrHash: attempt.buyerAddrHash,
        validationStatus: attempt.validationStatus,
        accepted: attempt.accepted,
        acceptingBlockHash: attempt.acceptingBlockHash,
        acceptingBlueScore: attempt.acceptingBlueScore,
        confirmations: attempt.confirmations,
        provisionalRank: attempt.provisionalRank,
        finalRank: attempt.finalRank,
        payloadHex: null,
        invalidReason: attempt.validationStatus === 'invalid_pow' ? 'Demo invalid PoW sample' : null,
        lastCheckedAt: new Date(),
      },
      create: {
        saleId: sale.id,
        requestedTicketTypeId: ticketTypeByCode.get(attempt.requestedTypeCode) ?? null,
        txid: attempt.txid,
        buyerAddrHash: attempt.buyerAddrHash,
        validationStatus: attempt.validationStatus,
        accepted: attempt.accepted,
        acceptingBlockHash: attempt.acceptingBlockHash,
        acceptingBlueScore: attempt.acceptingBlueScore,
        confirmations: attempt.confirmations,
        provisionalRank: attempt.provisionalRank,
        finalRank: attempt.finalRank,
        payloadHex: null,
        invalidReason: attempt.validationStatus === 'invalid_pow' ? 'Demo invalid PoW sample' : null,
        lastCheckedAt: new Date(),
      },
    })
  }
  console.log(`  - Purchase attempts seeded: ${sampleAttempts.length}`)

  const sampleTickets = [
    {
      id: '11111111-1111-4111-8111-111111111111',
      txid: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1',
      typeCode: 'VIP',
      ownerAddress: '0x1f8f9C7A13f2a0fB67d8d3d376fA7040A6f7B101',
      claimTxid: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc01',
      tokenId: '1',
      status: 'issued' as const,
      redeemedAt: null,
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      txid: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2',
      typeCode: 'R',
      ownerAddress: '0x2E06a2b5A3d2C73fb8c01Fb8A3C0Ee7fD50D1202',
      claimTxid: null,
      tokenId: null,
      status: 'issued' as const,
      redeemedAt: null,
    },
    {
      id: '33333333-3333-4333-8333-333333333333',
      txid: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3',
      typeCode: 'GEN',
      ownerAddress: '0x37C0c7E4c90e91fDa36d5f1b127f0dD4f32B4303',
      claimTxid: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc03',
      tokenId: '3',
      status: 'redeemed' as const,
      redeemedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
    },
  ]

  for (const ticket of sampleTickets) {
    const ownerAddrHash = sha256Hex(ticket.ownerAddress.toLowerCase())
    const qrSignature = signTicketData(ticket.id, sale.id, ticket.txid)

    await prisma.ticket.upsert({
      where: { id: ticket.id },
      update: {
        saleId: sale.id,
        ticketTypeId: ticketTypeByCode.get(ticket.typeCode) ?? null,
        ownerAddress: ticket.ownerAddress,
        ownerAddrHash,
        originTxid: ticket.txid,
        claimTxid: ticket.claimTxid,
        tokenId: ticket.tokenId,
        status: ticket.status,
        qrSignature,
        redeemedAt: ticket.redeemedAt,
      },
      create: {
        id: ticket.id,
        saleId: sale.id,
        ticketTypeId: ticketTypeByCode.get(ticket.typeCode) ?? null,
        ownerAddress: ticket.ownerAddress,
        ownerAddrHash,
        originTxid: ticket.txid,
        claimTxid: ticket.claimTxid,
        tokenId: ticket.tokenId,
        status: ticket.status,
        qrSignature,
        redeemedAt: ticket.redeemedAt,
      },
    })

    console.log(`  - Ticket sample: ${ticket.id} (${ticket.typeCode}, ${ticket.status})`)
    console.log(`    QR: TK1|${ticket.id}|${sale.id}|${ticket.txid}|${qrSignature}`)
  }

  console.log('Seeding complete!')
}

main()
  .catch((e) => {
    console.error('Seeding failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
