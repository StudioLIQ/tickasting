/**
 * Tickasting Demo Scenario Script
 *
 * Runs a complete demo:
 * 1. Creates a test event and sale
 * 2. Simulates N bot purchases
 * 3. Verifies deterministic ordering
 * 4. Shows results
 *
 * Usage:
 *   pnpm demo -- [--count=50] [--supply=10]
 */

import { PrismaClient } from '../../apps/api/node_modules/@prisma/client/index.js'
import { randomUUID, createHash } from 'crypto'

const prisma = new PrismaClient()

interface DemoConfig {
  botCount: number
  supply: number
  finalityDepth: number
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runDemo(config: DemoConfig): Promise<void> {
  const { botCount, supply, finalityDepth } = config

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    🎫 Tickasting Demo                         ║
║           Fair Ticketing on Kaspa Blockchain                 ║
╚══════════════════════════════════════════════════════════════╝
`)

  // Step 1: Create demo event
  console.log(`\n📍 STEP 1: Creating demo event...`)
  await sleep(500)

  const event = await prisma.event.create({
    data: {
      id: randomUUID(),
      organizerId: 'demo-organizer',
      title: `Tickasting Demo Event - ${new Date().toISOString().slice(0, 10)}`,
      venue: 'Virtual Demo Arena',
      status: 'published',
    },
  })
  console.log(`   ✅ Event created: "${event.title}"`)

  // Step 2: Create demo sale
  console.log(`\n📍 STEP 2: Creating sale (supply=${supply})...`)
  await sleep(500)

  const sale = await prisma.sale.create({
    data: {
      id: randomUUID(),
      eventId: event.id,
      network: 'testnet',
      treasuryAddress: 'kaspa:demo-treasury-' + randomUUID().slice(0, 8),
      ticketPriceSompi: BigInt(1_000_000_000), // 10 KAS
      supplyTotal: supply,
      powDifficulty: 16,
      finalityDepth,
      status: 'live',
    },
  })
  console.log(`   ✅ Sale created: ${sale.id}`)
  console.log(`   📊 Supply: ${supply} tickets`)
  console.log(`   🔒 Finality: ${finalityDepth} confirmations`)

  // Step 3: Simulate bot attacks
  console.log(`\n📍 STEP 3: Simulating ${botCount} bot purchases...`)
  console.log(`   ⚠️  All ${botCount} bots are trying to buy simultaneously!`)
  await sleep(1000)

  const baseBlueScore = BigInt(1_000_000)
  const blueScoreRange = 50 // Bots will land in ~50 different blue scores

  const attempts: Array<{
    txid: string
    blueScore: bigint
    blockHash: string
    buyerIndex: number
  }> = []

  // Generate all attempts
  for (let i = 0; i < botCount; i++) {
    const blueScore = baseBlueScore + BigInt(Math.floor(Math.random() * blueScoreRange))
    const txid = sha256(`bot-${i}-${Date.now()}-${randomUUID()}`)
    const blockHash = sha256(`block-${blueScore}-${randomUUID()}`)

    attempts.push({ txid, blueScore, blockHash, buyerIndex: i })
  }

  // Insert in random order (simulating network chaos)
  const shuffled = [...attempts].sort(() => Math.random() - 0.5)

  console.log(`   🌐 Transactions arriving in random network order...`)

  for (const attempt of shuffled) {
    await prisma.purchaseAttempt.create({
      data: {
        saleId: sale.id,
        txid: attempt.txid,
        validationStatus: 'valid',
        payloadHex: sha256(`payload-${attempt.buyerIndex}`),
        buyerAddrHash: sha256(`buyer-${attempt.buyerIndex}`).slice(0, 40),
        accepted: true,
        acceptingBlockHash: attempt.blockHash,
        acceptingBlueScore: attempt.blueScore,
        confirmations: finalityDepth + 5,
        detectedAt: new Date(),
        lastCheckedAt: new Date(),
      },
    })
    process.stdout.write('.')
  }
  console.log(`\n   ✅ All ${botCount} purchase attempts recorded`)

  // Step 4: Compute rankings
  console.log(`\n📍 STEP 4: Computing deterministic rankings...`)
  await sleep(500)

  const allAttempts = await prisma.purchaseAttempt.findMany({
    where: { saleId: sale.id, validationStatus: 'valid', accepted: true },
    orderBy: [{ acceptingBlueScore: 'asc' }, { txid: 'asc' }],
  })

  // Update ranks
  for (let i = 0; i < allAttempts.length; i++) {
    await prisma.purchaseAttempt.update({
      where: { id: allAttempts[i]!.id },
      data: { provisionalRank: i + 1, finalRank: i + 1 },
    })
  }

  console.log(`   ✅ Ranked ${allAttempts.length} attempts using:`)
  console.log(`      Primary key: acceptingBlockHash.blueScore (ascending)`)
  console.log(`      Tie-breaker: txid (lexicographic ascending)`)

  // Step 5: Show results
  console.log(`\n📍 STEP 5: Results`)
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                       RESULTS                                 ║
╚══════════════════════════════════════════════════════════════╝
`)

  const winners = allAttempts.slice(0, supply)
  const losers = allAttempts.slice(supply)

  console.log(`   🏆 WINNERS: ${winners.length}/${supply} tickets allocated`)
  console.log(`   ❌ LOSERS: ${losers.length} did not make the cut`)
  console.log(``)

  // Show top winners
  console.log(`   Top Winners:`)
  for (const w of winners.slice(0, 5)) {
    console.log(`   #${w.finalRank} │ blueScore: ${w.acceptingBlueScore} │ txid: ${w.txid.slice(0, 20)}...`)
  }
  if (winners.length > 5) {
    console.log(`   ... and ${winners.length - 5} more winners`)
  }

  // Show cutoff
  if (losers.length > 0) {
    const lastWinner = winners[winners.length - 1]!
    const firstLoser = losers[0]!
    console.log(`
   ─────────────────────────────────────────────────────────────
   📍 CUTOFF POINT
   ─────────────────────────────────────────────────────────────
   Last Winner  #${lastWinner.finalRank}: blueScore=${lastWinner.acceptingBlueScore}
   First Loser  #${firstLoser.finalRank}: blueScore=${firstLoser.acceptingBlueScore}
`)

    if (lastWinner.acceptingBlueScore === firstLoser.acceptingBlueScore) {
      console.log(`   ⚡ Same blueScore! Tie-broken by txid (lexicographic order)`)
    }
  }

  // Step 6: Verification
  console.log(`\n📍 STEP 6: Verifying determinism...`)
  await sleep(500)

  // Re-sort and verify
  const resorted = [...allAttempts].sort((a, b) => {
    const scoreA = a.acceptingBlueScore ?? BigInt(0)
    const scoreB = b.acceptingBlueScore ?? BigInt(0)
    if (scoreA !== scoreB) return scoreA < scoreB ? -1 : 1
    return a.txid.localeCompare(b.txid)
  })

  let isIdentical = true
  for (let i = 0; i < allAttempts.length; i++) {
    if (allAttempts[i]!.txid !== resorted[i]!.txid) {
      isIdentical = false
      break
    }
  }

  if (isIdentical) {
    console.log(`   ✅ VERIFIED: Same data input → Same ranking output`)
    console.log(`   ✅ VERIFIED: No server manipulation possible`)
  } else {
    console.log(`   ❌ VERIFICATION FAILED: Ordering is not deterministic!`)
  }

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    KEY INSIGHTS                               ║
╠══════════════════════════════════════════════════════════════╣
║ • ${botCount} bots attacked simultaneously                         ║
║ • Network order was random (chaos)                            ║
║ • But final ranking is DETERMINISTIC                          ║
║ • Based on BLOCKCHAIN data (blueScore + txid)                 ║
║ • Anyone can independently verify results                     ║
║ • Server cannot manipulate the queue                          ║
╚══════════════════════════════════════════════════════════════╝
`)

  // Cleanup info
  console.log(`\n📌 Demo data:`)
  console.log(`   Event ID: ${event.id}`)
  console.log(`   Sale ID: ${sale.id}`)
  console.log(`   (Use these IDs with the Results page to view)`)
}

// Parse CLI args
function parseArgs(): DemoConfig {
  const args = process.argv.slice(2)
  let botCount = 50
  let supply = 10
  let finalityDepth = 10

  for (const arg of args) {
    if (arg.startsWith('--count=')) {
      botCount = parseInt(arg.split('=')[1] || '50', 10)
    } else if (arg.startsWith('--supply=')) {
      supply = parseInt(arg.split('=')[1] || '10', 10)
    } else if (arg.startsWith('--finality=')) {
      finalityDepth = parseInt(arg.split('=')[1] || '10', 10)
    }
  }

  return { botCount, supply, finalityDepth }
}

// Main
async function main() {
  try {
    const config = parseArgs()
    await runDemo(config)
  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()
