import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding database...')

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
    update: {},
    create: {
      id: 'demo-sale-001',
      eventId: event.id,
      network: 'testnet',
      treasuryAddress: 'kaspa:qz0ckdefn2xawf7gxvw6ztjm5w3s38hl2rq0t07l3uy4kskqxcqqjld7w5v6r',
      ticketPriceSompi: BigInt(100_000_000), // 1 KAS
      supplyTotal: 100,
      maxPerAddress: 2,
      powDifficulty: 18,
      finalityDepth: 30,
      startAt: new Date('2025-02-15T10:00:00Z'),
      endAt: new Date('2025-02-15T12:00:00Z'),
      status: 'scheduled',
    },
  })

  console.log(`Created sale: ${sale.id} for event ${event.title}`)
  console.log(`  - Price: ${sale.ticketPriceSompi} sompi`)
  console.log(`  - Supply: ${sale.supplyTotal}`)
  console.log(`  - PoW Difficulty: ${sale.powDifficulty}`)

  // Create ticket types (VIP / Reserved / General)
  const ticketTypes = [
    {
      id: 'demo-type-vip',
      saleId: sale.id,
      code: 'VIP',
      name: 'VIP Standing',
      priceSompi: BigInt(500_000_000), // 5 KAS
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
      priceSompi: BigInt(200_000_000), // 2 KAS
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
      priceSompi: BigInt(100_000_000), // 1 KAS
      supply: 50,
      metadataUri: 'ipfs://demo/general',
      perk: null,
      sortOrder: 2,
    },
  ]

  for (const tt of ticketTypes) {
    await prisma.ticketType.upsert({
      where: { id: tt.id },
      update: {},
      create: tt,
    })
    console.log(`  - Ticket type: ${tt.code} (${tt.name}) — supply: ${tt.supply}, price: ${tt.priceSompi} sompi`)
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
