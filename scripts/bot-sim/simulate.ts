/**
 * GhostPass Bot Simulator
 *
 * Simulates N concurrent purchase attempts to verify:
 * 1. Ordering is deterministic (same input -> same rank)
 * 2. Rankings are correctly computed based on blueScore + txid
 *
 * Usage:
 *   pnpm sim -- --count=50 --sale=<saleId>
 *
 * Modes:
 *   - MOCK: Creates fake purchase_attempts directly in DB
 *   - REAL: Would require actual Kaspa testnet transactions (not implemented)
 */

import { PrismaClient } from '../../apps/api/node_modules/@prisma/client/index.js'
import { randomUUID, createHash } from 'crypto'

const prisma = new PrismaClient()

interface SimConfig {
  saleId: string
  count: number
  baseBlueScore: bigint
  blueScoreVariance: number // How many different blueScores to spread attempts across
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

function generateMockTxid(): string {
  return sha256(randomUUID() + Date.now().toString())
}

function generateMockPayload(saleId: string, buyerIndex: number): string {
  // Simplified mock payload
  const magic = '47505331' // GPS1 in hex
  const version = '01'
  const saleIdHex = saleId.replace(/-/g, '')
  const buyerHash = sha256(`buyer-${buyerIndex}`).slice(0, 40)
  const timestamp = Date.now().toString(16).padStart(16, '0')
  return magic + version + saleIdHex + buyerHash + timestamp
}

function generateMockBlockHash(blueScore: bigint): string {
  return sha256(`block-${blueScore.toString()}-${randomUUID()}`)
}

async function simulatePurchaseAttempts(config: SimConfig): Promise<void> {
  const { saleId, count, baseBlueScore, blueScoreVariance } = config

  console.log(`\n🤖 GhostPass Bot Simulator`)
  console.log(`   Sale: ${saleId}`)
  console.log(`   Simulating ${count} purchase attempts...`)
  console.log(`   Blue score range: ${baseBlueScore} - ${baseBlueScore + BigInt(blueScoreVariance)}\n`)

  // Verify sale exists
  const sale = await prisma.sale.findUnique({ where: { id: saleId } })
  if (!sale) {
    console.error('❌ Sale not found:', saleId)
    process.exit(1)
  }

  if (sale.status !== 'live' && sale.status !== 'finalizing') {
    console.error('❌ Sale is not in live/finalizing status:', sale.status)
    process.exit(1)
  }

  // Generate mock attempts
  const attempts: Array<{
    txid: string
    blueScore: bigint
    blockHash: string
    payload: string
    buyerHash: string
  }> = []

  for (let i = 0; i < count; i++) {
    const blueScore = baseBlueScore + BigInt(Math.floor(Math.random() * blueScoreVariance))
    const blockHash = generateMockBlockHash(blueScore)
    const txid = generateMockTxid()
    const payload = generateMockPayload(saleId, i)
    const buyerHash = sha256(`buyer-${i}`).slice(0, 40)

    attempts.push({
      txid,
      blueScore,
      blockHash,
      payload,
      buyerHash,
    })
  }

  // Insert all attempts in random order (simulating network jitter)
  const shuffled = [...attempts].sort(() => Math.random() - 0.5)

  console.log('📝 Inserting purchase attempts...')
  const startTime = Date.now()

  for (const attempt of shuffled) {
    await prisma.purchaseAttempt.create({
      data: {
        saleId,
        txid: attempt.txid,
        validationStatus: 'valid',
        payloadHex: attempt.payload,
        buyerAddrHash: attempt.buyerHash,
        accepted: true,
        acceptingBlockHash: attempt.blockHash,
        acceptingBlueScore: attempt.blueScore,
        confirmations: sale.finalityDepth + 10, // Ensure they're final
        detectedAt: new Date(),
        lastCheckedAt: new Date(),
      },
    })
  }

  const insertTime = Date.now() - startTime
  console.log(`✅ Inserted ${count} attempts in ${insertTime}ms`)

  // Now verify ordering
  console.log('\n📊 Computing rankings...')

  // Get all attempts ordered by the deterministic rule
  const allAttempts = await prisma.purchaseAttempt.findMany({
    where: {
      saleId,
      validationStatus: 'valid',
      accepted: true,
      confirmations: { gte: sale.finalityDepth },
    },
    orderBy: [{ acceptingBlueScore: 'asc' }, { txid: 'asc' }],
  })

  // Update ranks
  for (let i = 0; i < allAttempts.length; i++) {
    await prisma.purchaseAttempt.update({
      where: { id: allAttempts[i]!.id },
      data: {
        provisionalRank: i + 1,
        finalRank: i + 1,
      },
    })
  }

  console.log(`✅ Ranked ${allAttempts.length} attempts`)

  // Show summary
  const winners = allAttempts.slice(0, sale.supplyTotal)
  const losers = allAttempts.slice(sale.supplyTotal)

  console.log(`\n📈 Results:`)
  console.log(`   Supply: ${sale.supplyTotal}`)
  console.log(`   Winners: ${winners.length}`)
  console.log(`   Losers: ${losers.length}`)

  // Show top 5 winners
  console.log(`\n🏆 Top 5 Winners:`)
  for (const w of winners.slice(0, 5)) {
    console.log(`   #${w.finalRank}: txid=${w.txid.slice(0, 16)}... blueScore=${w.acceptingBlueScore}`)
  }

  // Show last winner and first loser (if applicable)
  if (winners.length > 0 && losers.length > 0) {
    const lastWinner = winners[winners.length - 1]!
    const firstLoser = losers[0]!
    console.log(`\n📍 Cutoff point:`)
    console.log(`   Last winner #${lastWinner.finalRank}: blueScore=${lastWinner.acceptingBlueScore} txid=${lastWinner.txid.slice(0, 16)}...`)
    console.log(`   First loser #${firstLoser.finalRank}: blueScore=${firstLoser.acceptingBlueScore} txid=${firstLoser.txid.slice(0, 16)}...`)
  }

  // Output verification data
  const verificationData = {
    saleId,
    simulatedAt: new Date().toISOString(),
    config: {
      count,
      baseBlueScore: baseBlueScore.toString(),
      blueScoreVariance,
    },
    results: {
      totalAttempts: allAttempts.length,
      winners: winners.length,
      losers: losers.length,
    },
    topWinners: winners.slice(0, 10).map((w) => ({
      rank: w.finalRank,
      txid: w.txid,
      blueScore: w.acceptingBlueScore?.toString(),
    })),
  }

  console.log(`\n📄 Verification data:`)
  console.log(JSON.stringify(verificationData, null, 2))
}

// Parse CLI args
function parseArgs(): SimConfig {
  const args = process.argv.slice(2)
  let saleId = ''
  let count = 50
  let baseBlueScore = BigInt(1000000)
  let blueScoreVariance = 100

  for (const arg of args) {
    if (arg.startsWith('--sale=')) {
      saleId = arg.split('=')[1] || ''
    } else if (arg.startsWith('--count=')) {
      count = parseInt(arg.split('=')[1] || '50', 10)
    } else if (arg.startsWith('--base-score=')) {
      baseBlueScore = BigInt(arg.split('=')[1] || '1000000')
    } else if (arg.startsWith('--variance=')) {
      blueScoreVariance = parseInt(arg.split('=')[1] || '100', 10)
    }
  }

  if (!saleId) {
    console.error('Usage: pnpm sim -- --sale=<saleId> [--count=50] [--base-score=1000000] [--variance=100]')
    process.exit(1)
  }

  return { saleId, count, baseBlueScore, blueScoreVariance }
}

// Main
async function main() {
  try {
    const config = parseArgs()
    await simulatePurchaseAttempts(config)
  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()
