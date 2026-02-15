import { PrismaClient } from '@prisma/client'
import { createHash, createHmac } from 'crypto'

const prisma = new PrismaClient()
const defaultTreasuryAddress =
  process.env['DEMO_TREASURY_ADDRESS'] ||
  process.env['DEPLOYER_ADDRESS'] ||
  '0xdeCBa1c1b410458A07adAC185Ab774B716B4e7a3'
const claimContractAddress = process.env['TICKASTING_CONTRACT_ADDRESS'] || null
const ticketSecret = process.env['TICKET_SECRET'] || 'dev-ticket-secret-change-in-prod'

interface TicketTypeSeed {
  code: string
  name: string
  priceSompi: number
  supply: number
  metadataUri: string
  perk: Record<string, unknown> | null
}

interface SaleSeed {
  id: string
  status: 'live' | 'finalized'
  supplyTotal: number
  maxPerAddress: number
  startOffsetDays: number
  endOffsetDays: number
  seededTicketCount: number
  seededInvalidAttempts: number
  ticketTypes: TicketTypeSeed[]
}

interface EventSeed {
  id: string
  organizerId: string
  title: string
  venue: string
  startAtIso: string
  endAtIso: string
  sale: SaleSeed
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

function signTicketData(ticketId: string, saleId: string, txid: string): string {
  const message = `${ticketId}|${saleId}|${txid}`
  return createHmac('sha256', ticketSecret).update(message).digest('hex')
}

function evmAddressFromSeed(seed: string): string {
  return `0x${sha256Hex(seed).slice(0, 40)}`
}

function txHashFromSeed(seed: string): string {
  return `0x${sha256Hex(seed).slice(0, 64)}`
}

function blockHashFromSeed(seed: string): string {
  return `0x${sha256Hex(`block:${seed}`).slice(0, 64)}`
}

function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000)
}

const eventSeeds: EventSeed[] = [
  {
    id: 'seed-event-aurora-pulse-2026',
    organizerId: 'live-stage-seoul',
    title: 'Aurora Pulse Live in Seoul 2026',
    venue: 'Jamsil Indoor Arena, Seoul',
    startAtIso: '2026-06-14T11:00:00.000Z',
    endAtIso: '2026-06-14T14:00:00.000Z',
    sale: {
      id: 'seed-sale-aurora-pulse-2026',
      status: 'live',
      supplyTotal: 360,
      maxPerAddress: 4,
      startOffsetDays: -3,
      endOffsetDays: 21,
      seededTicketCount: 64,
      seededInvalidAttempts: 16,
      ticketTypes: [
        {
          code: 'VIP',
          name: 'VIP Soundcheck Package',
          priceSompi: 500_000,
          supply: 60,
          metadataUri: 'https://picsum.photos/seed/aurora-vip/1200/1600',
          perk: { section: 'VIP', row: 'L', seatNumber: '1-60', soundcheckAccess: true },
        },
        {
          code: 'FLOOR',
          name: 'Floor Zone',
          priceSompi: 320_000,
          supply: 140,
          metadataUri: 'https://picsum.photos/seed/aurora-floor/1200/1600',
          perk: { section: 'F', row: 'A', seatNumber: '1-140' },
        },
        {
          code: 'BALC',
          name: 'Balcony Reserved',
          priceSompi: 180_000,
          supply: 160,
          metadataUri: 'https://picsum.photos/seed/aurora-balc/1200/1600',
          perk: { section: 'B', row: 'R', seatNumber: '1-160' },
        },
      ],
    },
  },
  {
    id: 'seed-event-neon-harbor-2026',
    organizerId: 'coastline-ent',
    title: 'Neon Harbor Nights Tour - Busan',
    venue: 'BEXCO Auditorium, Busan',
    startAtIso: '2026-07-05T10:30:00.000Z',
    endAtIso: '2026-07-05T13:30:00.000Z',
    sale: {
      id: 'seed-sale-neon-harbor-2026',
      status: 'live',
      supplyTotal: 320,
      maxPerAddress: 4,
      startOffsetDays: -1,
      endOffsetDays: 18,
      seededTicketCount: 58,
      seededInvalidAttempts: 14,
      ticketTypes: [
        {
          code: 'PIT',
          name: 'Front Pit',
          priceSompi: 450_000,
          supply: 70,
          metadataUri: 'https://picsum.photos/seed/neon-pit/1200/1600',
          perk: { section: 'PIT', row: 'A', seatNumber: '1-70' },
        },
        {
          code: 'R',
          name: 'Reserved R',
          priceSompi: 280_000,
          supply: 110,
          metadataUri: 'https://picsum.photos/seed/neon-r/1200/1600',
          perk: { section: 'R', row: 'C', seatNumber: '1-110' },
        },
        {
          code: 'S',
          name: 'Standard S',
          priceSompi: 150_000,
          supply: 140,
          metadataUri: 'https://picsum.photos/seed/neon-s/1200/1600',
          perk: { section: 'S', row: 'F', seatNumber: '1-140' },
        },
      ],
    },
  },
  {
    id: 'seed-event-riverfront-beats-2026',
    organizerId: 'openair-festival-kr',
    title: 'Riverfront Summer Beats 2026',
    venue: 'Hangang Riverside Stage, Seoul',
    startAtIso: '2026-08-22T08:00:00.000Z',
    endAtIso: '2026-08-22T16:00:00.000Z',
    sale: {
      id: 'seed-sale-riverfront-beats-2026',
      status: 'live',
      supplyTotal: 520,
      maxPerAddress: 6,
      startOffsetDays: -5,
      endOffsetDays: 30,
      seededTicketCount: 82,
      seededInvalidAttempts: 20,
      ticketTypes: [
        {
          code: 'FESTVIP',
          name: 'Festival VIP Pass',
          priceSompi: 400_000,
          supply: 80,
          metadataUri: 'https://picsum.photos/seed/river-vip/1200/1600',
          perk: { section: 'VIP', loungeAccess: true, fastTrack: true },
        },
        {
          code: 'DAYPASS',
          name: 'Day Pass',
          priceSompi: 180_000,
          supply: 220,
          metadataUri: 'https://picsum.photos/seed/river-day/1200/1600',
          perk: { seat: 'Open Standing Zone' },
        },
        {
          code: 'NIGHT',
          name: 'Night Session',
          priceSompi: 100_000,
          supply: 220,
          metadataUri: 'https://picsum.photos/seed/river-night/1200/1600',
          perk: { seat: 'Night Stage Standing' },
        },
      ],
    },
  },
  {
    id: 'seed-event-city-strings-2026',
    organizerId: 'metropolitan-arts',
    title: 'City Strings Live: Film Score Gala',
    venue: 'Sejong Center Grand Theater, Seoul',
    startAtIso: '2026-05-17T10:00:00.000Z',
    endAtIso: '2026-05-17T12:30:00.000Z',
    sale: {
      id: 'seed-sale-city-strings-2026',
      status: 'finalized',
      supplyTotal: 280,
      maxPerAddress: 3,
      startOffsetDays: -35,
      endOffsetDays: -12,
      seededTicketCount: 48,
      seededInvalidAttempts: 12,
      ticketTypes: [
        {
          code: 'BOX',
          name: 'Premium Box',
          priceSompi: 500_000,
          supply: 40,
          metadataUri: 'https://picsum.photos/seed/strings-box/1200/1600',
          perk: { section: 'BOX', row: 'B', seatNumber: '1-40' },
        },
        {
          code: 'ORCH',
          name: 'Orchestra Seat',
          priceSompi: 300_000,
          supply: 110,
          metadataUri: 'https://picsum.photos/seed/strings-orch/1200/1600',
          perk: { section: 'ORCH', row: 'D', seatNumber: '1-110' },
        },
        {
          code: 'MEZZ',
          name: 'Mezzanine',
          priceSompi: 140_000,
          supply: 130,
          metadataUri: 'https://picsum.photos/seed/strings-mezz/1200/1600',
          perk: { section: 'MEZZ', row: 'H', seatNumber: '1-130' },
        },
      ],
    },
  },
]

async function cleanupManagedSeedData() {
  const targetSalesQuery = `
    SELECT id FROM "public"."sales"
    WHERE id LIKE 'seed-sale-%'
       OR id = 'demo-sale-001'
       OR event_id IN (
         SELECT id FROM "public"."events"
         WHERE id LIKE 'seed-event-%'
            OR organizer_id = 'demo-organizer'
            OR title ILIKE '%demo%'
       )
  `

  await prisma.$executeRawUnsafe(
    `DELETE FROM "public"."scans"
     WHERE ticket_id IN (
       SELECT id FROM "public"."tickets"
       WHERE sale_id IN (${targetSalesQuery})
     )`
  )

  await prisma.$executeRawUnsafe(
    `DELETE FROM "public"."tickets"
     WHERE sale_id IN (${targetSalesQuery})`
  )

  await prisma.$executeRawUnsafe(
    `DELETE FROM "public"."purchase_attempts"
     WHERE sale_id IN (${targetSalesQuery})`
  )

  await prisma.$executeRawUnsafe(
    `DELETE FROM "public"."ticket_types"
     WHERE sale_id IN (${targetSalesQuery})`
  )

  await prisma.$executeRawUnsafe(
    `DELETE FROM "public"."sales"
     WHERE id IN (${targetSalesQuery})`
  )

  await prisma.$executeRawUnsafe(
    `DELETE FROM "public"."events"
     WHERE id LIKE 'seed-event-%'
        OR organizer_id = 'demo-organizer'
        OR title ILIKE '%demo%'`
  )
}

async function main() {
  console.log('Seeding realistic concert data...')
  await cleanupManagedSeedData()

  const now = new Date()
  const ownerPool = Array.from({ length: 260 }, (_, i) =>
    evmAddressFromSeed(`seed-owner-wallet-${i + 1}`)
  )

  let ownerCursor = 0
  let globalTicketCounter = 0
  let globalAttemptCounter = 0

  for (const [eventIndex, eventSeed] of eventSeeds.entries()) {
    const event = await prisma.event.create({
      data: {
        id: eventSeed.id,
        organizerId: eventSeed.organizerId,
        title: eventSeed.title,
        venue: eventSeed.venue,
        startAt: new Date(eventSeed.startAtIso),
        endAt: new Date(eventSeed.endAtIso),
        status: 'published',
      },
    })

    const saleSeed = eventSeed.sale
    const ticketPriceSompi = Math.min(...saleSeed.ticketTypes.map((tt) => tt.priceSompi))
    const sale = await prisma.sale.create({
      data: {
        id: saleSeed.id,
        eventId: event.id,
        network: 'kasplex-testnet',
        treasuryAddress: evmAddressFromSeed(
          `seed-treasury-${eventIndex + 1}-${defaultTreasuryAddress.toLowerCase()}`
        ),
        ticketPriceSompi: BigInt(ticketPriceSompi),
        supplyTotal: saleSeed.supplyTotal,
        maxPerAddress: saleSeed.maxPerAddress,
        powDifficulty: 18,
        finalityDepth: 12,
        fallbackEnabled: false,
        startAt: addDays(now, saleSeed.startOffsetDays),
        endAt: addDays(now, saleSeed.endOffsetDays),
        status: saleSeed.status,
        claimContractAddress,
      },
    })

    const ticketTypeByCode = new Map<string, string>()
    for (const [sortOrder, ticketTypeSeed] of saleSeed.ticketTypes.entries()) {
      const ticketType = await prisma.ticketType.create({
        data: {
          id: `${sale.id}-type-${ticketTypeSeed.code.toLowerCase()}`,
          saleId: sale.id,
          code: ticketTypeSeed.code,
          name: ticketTypeSeed.name,
          priceSompi: BigInt(ticketTypeSeed.priceSompi),
          supply: ticketTypeSeed.supply,
          metadataUri: ticketTypeSeed.metadataUri,
          perk: ticketTypeSeed.perk ?? undefined,
          sortOrder,
        },
      })
      ticketTypeByCode.set(ticketTypeSeed.code, ticketType.id)
    }

    for (let i = 0; i < saleSeed.seededTicketCount; i += 1) {
      const ticketTypeSeed = saleSeed.ticketTypes[i % saleSeed.ticketTypes.length]
      const txid = txHashFromSeed(`${sale.id}-winner-${i + 1}`)
      const ownerAddress = ownerPool[ownerCursor % ownerPool.length] || evmAddressFromSeed(`fallback-owner-${i + 1}`)
      ownerCursor += 1
      globalAttemptCounter += 1

      await prisma.purchaseAttempt.create({
        data: {
          saleId: sale.id,
          requestedTicketTypeId: ticketTypeByCode.get(ticketTypeSeed.code) ?? null,
          txid,
          buyerAddrHash: sha256Hex(ownerAddress.toLowerCase()),
          validationStatus: 'valid',
          invalidReason: null,
          payloadHex: null,
          accepted: true,
          acceptingBlockHash: blockHashFromSeed(`${sale.id}-winner-${i + 1}`),
          acceptingBlueScore: BigInt(2_300_000 + i),
          confirmations: 14 + (i % 12),
          provisionalRank: i + 1,
          finalRank: i + 1,
          lastCheckedAt: now,
        },
      })

      const ticketId = `${sale.id}-ticket-${String(i + 1).padStart(3, '0')}`
      const claimTxid = i % 3 === 0 ? txHashFromSeed(`${sale.id}-claim-${i + 1}`) : null
      const tokenId = claimTxid ? String(i + 1) : null
      const isRedeemed = i % 9 === 0
      const redeemedAt = isRedeemed ? addDays(now, -(i % 7) - 1) : null
      const qrSignature = signTicketData(ticketId, sale.id, txid)

      await prisma.ticket.create({
        data: {
          id: ticketId,
          saleId: sale.id,
          ticketTypeId: ticketTypeByCode.get(ticketTypeSeed.code) ?? null,
          ownerAddress,
          ownerAddrHash: sha256Hex(ownerAddress.toLowerCase()),
          originTxid: txid,
          claimTxid,
          tokenId,
          status: isRedeemed ? 'redeemed' : 'issued',
          qrSignature,
          redeemedAt,
        },
      })

      if (isRedeemed) {
        await prisma.scan.create({
          data: {
            ticketId,
            gateId: `gate-${(i % 4) + 1}`,
            operatorId: 'seed-gate-bot',
            result: 'ok',
          },
        })
      }

      globalTicketCounter += 1
    }

    for (let i = 0; i < saleSeed.seededInvalidAttempts; i += 1) {
      const txid = txHashFromSeed(`${sale.id}-invalid-${i + 1}`)
      globalAttemptCounter += 1

      await prisma.purchaseAttempt.create({
        data: {
          saleId: sale.id,
          requestedTicketTypeId: null,
          txid,
          buyerAddrHash: sha256Hex(`invalid-attempt-${sale.id}-${i + 1}`),
          validationStatus: i % 2 === 0 ? 'invalid_wrong_amount' : 'invalid_pow',
          invalidReason: i % 2 === 0 ? 'Wrong USDC amount for ticket price' : 'Failed PoW validation',
          payloadHex: null,
          accepted: false,
          acceptingBlockHash: null,
          acceptingBlueScore: null,
          confirmations: i % 6,
          provisionalRank: null,
          finalRank: null,
          lastCheckedAt: now,
        },
      })
    }

    console.log(`Event: ${event.title}`)
    console.log(`  Sale: ${sale.id} (${sale.status})`)
    console.log(`  Price range: 0.1 - 0.5 USDC`)
    console.log(`  Ticket rows seeded: ${saleSeed.seededTicketCount}`)
    console.log(`  Invalid attempts seeded: ${saleSeed.seededInvalidAttempts}`)
  }

  console.log('Seeding complete!')
  console.log(`  - Events seeded: ${eventSeeds.length}`)
  console.log(`  - Sales seeded: ${eventSeeds.length}`)
  console.log(`  - Purchase attempts seeded: ${globalAttemptCounter}`)
  console.log(`  - Tickets seeded: ${globalTicketCounter}`)
  console.log(`  - Unique owner wallets used: ${Math.min(ownerCursor, ownerPool.length)}`)
}

main()
  .catch((e) => {
    console.error('Seeding failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
