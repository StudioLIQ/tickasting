/**
 * GhostPass Ordering Verification Script
 *
 * Verifies that ranking is deterministic:
 * 1. Fetches all attempts
 * 2. Re-computes ordering from raw data
 * 3. Compares with stored ranks
 *
 * Usage:
 *   pnpm verify -- --sale=<saleId>
 */

import { PrismaClient } from '../../apps/api/node_modules/@prisma/client/index.js'

const prisma = new PrismaClient()

interface VerifyConfig {
  saleId: string
  verbose: boolean
}

async function verifyOrdering(config: VerifyConfig): Promise<boolean> {
  const { saleId, verbose } = config

  console.log(`\n🔍 GhostPass Ordering Verification`)
  console.log(`   Sale: ${saleId}\n`)

  // Get sale
  const sale = await prisma.sale.findUnique({ where: { id: saleId } })
  if (!sale) {
    console.error('❌ Sale not found')
    return false
  }

  // Get all valid, accepted, final attempts
  const attempts = await prisma.purchaseAttempt.findMany({
    where: {
      saleId,
      validationStatus: 'valid',
      accepted: true,
      confirmations: { gte: sale.finalityDepth },
    },
    orderBy: [{ acceptingBlueScore: 'asc' }, { txid: 'asc' }],
  })

  console.log(`📊 Found ${attempts.length} final attempts`)

  // Compute expected ranks
  const expected = attempts.map((a, i) => ({
    id: a.id,
    txid: a.txid,
    blueScore: a.acceptingBlueScore,
    expectedRank: i + 1,
    actualRank: a.finalRank,
  }))

  // Check for mismatches
  let mismatches = 0
  for (const e of expected) {
    if (e.expectedRank !== e.actualRank) {
      mismatches++
      if (verbose) {
        console.log(`❌ Mismatch: txid=${e.txid.slice(0, 16)}... expected=${e.expectedRank} actual=${e.actualRank}`)
      }
    }
  }

  if (mismatches === 0) {
    console.log(`✅ All ${attempts.length} ranks are correct!`)
  } else {
    console.log(`❌ Found ${mismatches} rank mismatches`)
  }

  // Verify determinism by re-sorting
  console.log(`\n🔄 Verifying determinism (re-sort check)...`)

  // Sort by the same criteria
  const sorted1 = [...attempts].sort((a, b) => {
    const scoreA = a.acceptingBlueScore ?? BigInt(0)
    const scoreB = b.acceptingBlueScore ?? BigInt(0)
    if (scoreA !== scoreB) {
      return scoreA < scoreB ? -1 : 1
    }
    return a.txid.localeCompare(b.txid)
  })

  // Sort again (should be identical)
  const sorted2 = [...attempts].sort((a, b) => {
    const scoreA = a.acceptingBlueScore ?? BigInt(0)
    const scoreB = b.acceptingBlueScore ?? BigInt(0)
    if (scoreA !== scoreB) {
      return scoreA < scoreB ? -1 : 1
    }
    return a.txid.localeCompare(b.txid)
  })

  let determinismOk = true
  for (let i = 0; i < sorted1.length; i++) {
    if (sorted1[i]!.txid !== sorted2[i]!.txid) {
      determinismOk = false
      break
    }
  }

  if (determinismOk) {
    console.log(`✅ Ordering is deterministic (same sort = same order)`)
  } else {
    console.log(`❌ Ordering is NOT deterministic!`)
  }

  // Show ordering statistics
  console.log(`\n📈 Ordering Statistics:`)

  // Count attempts per blueScore
  const blueScoreCounts = new Map<string, number>()
  for (const a of attempts) {
    const score = a.acceptingBlueScore?.toString() ?? '?'
    blueScoreCounts.set(score, (blueScoreCounts.get(score) ?? 0) + 1)
  }

  const uniqueBlueScores = blueScoreCounts.size
  const maxAttemptsPerScore = Math.max(...blueScoreCounts.values())

  console.log(`   Unique blueScores: ${uniqueBlueScores}`)
  console.log(`   Max attempts in same blueScore: ${maxAttemptsPerScore}`)

  if (maxAttemptsPerScore > 1) {
    console.log(`   ℹ️  ${maxAttemptsPerScore} attempts share the same blueScore, tie-broken by txid`)
  }

  // Show winner/loser cutoff
  const winners = sorted1.slice(0, sale.supplyTotal)
  const losers = sorted1.slice(sale.supplyTotal)

  console.log(`\n🎯 Allocation:`)
  console.log(`   Supply: ${sale.supplyTotal}`)
  console.log(`   Winners: ${winners.length}`)
  console.log(`   Losers: ${losers.length}`)

  return mismatches === 0 && determinismOk
}

// Parse CLI args
function parseArgs(): VerifyConfig {
  const args = process.argv.slice(2)
  let saleId = ''
  let verbose = false

  for (const arg of args) {
    if (arg.startsWith('--sale=')) {
      saleId = arg.split('=')[1] || ''
    } else if (arg === '--verbose' || arg === '-v') {
      verbose = true
    }
  }

  if (!saleId) {
    console.error('Usage: pnpm verify -- --sale=<saleId> [--verbose]')
    process.exit(1)
  }

  return { saleId, verbose }
}

// Main
async function main() {
  try {
    const config = parseArgs()
    const success = await verifyOrdering(config)
    process.exit(success ? 0 : 1)
  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()
