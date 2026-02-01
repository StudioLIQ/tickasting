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
      title: 'GhostPass Demo Concert',
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
