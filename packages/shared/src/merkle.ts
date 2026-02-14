/**
 * Merkle Tree utilities for Tickasting
 *
 * Used to generate tamper-proof commitment of allocation results.
 * The merkle root can be committed to the blockchain for verification.
 */

import { sha256 as sha256Bytes } from './pow.js'

/**
 * SHA-256 hash returning hex string
 */
function sha256(message: string): string {
  const bytes = sha256Bytes(message)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Leaf data for merkle tree generation
 */
export interface MerkleLeaf {
  finalRank: number
  txid: string
  acceptingBlockHash: string | null
  acceptingBlueScore: string | null
  buyerAddrHash: string | null
}

/**
 * Merkle proof for verifying a leaf's inclusion
 */
export interface MerkleProof {
  leaf: string
  leafIndex: number
  proof: Array<{
    hash: string
    position: 'left' | 'right'
  }>
  root: string
}

/**
 * Hash two values together (sorted to ensure consistency)
 */
function hashPair(a: string, b: string): string {
  // Always hash in sorted order for consistency
  const [first, second] = a < b ? [a, b] : [b, a]
  return sha256(first + second)
}

/**
 * Compute leaf hash from winner data
 * Format: sha256(finalRank|txid|acceptingBlockHash|acceptingBlueScore|buyerAddrHash)
 */
export function computeLeafHash(leaf: MerkleLeaf): string {
  const data = [
    leaf.finalRank.toString(),
    leaf.txid,
    leaf.acceptingBlockHash ?? '',
    leaf.acceptingBlueScore ?? '',
    leaf.buyerAddrHash ?? '',
  ].join('|')
  return sha256(data)
}

/**
 * Build merkle tree from leaves
 * Returns all levels of the tree (leaves at level 0, root at last level)
 */
export function buildMerkleTree(leaves: MerkleLeaf[]): string[][] {
  if (leaves.length === 0) {
    return [[sha256('EMPTY_TREE')]]
  }

  // Level 0: leaf hashes
  let currentLevel: string[] = leaves.map(computeLeafHash)
  const tree: string[][] = [currentLevel]

  // Build up the tree
  while (currentLevel.length > 1) {
    const nextLevel: string[] = []

    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i]!
      const right = i + 1 < currentLevel.length ? currentLevel[i + 1]! : left
      nextLevel.push(hashPair(left, right))
    }

    currentLevel = nextLevel
    tree.push(currentLevel)
  }

  return tree
}

/**
 * Get merkle root from leaves
 */
export function computeMerkleRoot(leaves: MerkleLeaf[]): string {
  const tree = buildMerkleTree(leaves)
  const lastLevel = tree[tree.length - 1]
  if (!lastLevel || lastLevel.length === 0) {
    throw new Error('Invalid merkle tree')
  }
  return lastLevel[0]!
}

/**
 * Generate merkle proof for a specific leaf
 */
export function generateMerkleProof(
  leaves: MerkleLeaf[],
  leafIndex: number
): MerkleProof | null {
  if (leafIndex < 0 || leafIndex >= leaves.length) {
    return null
  }

  const tree = buildMerkleTree(leaves)
  const firstLevel = tree[0]
  if (!firstLevel) {
    return null
  }
  const leafHash = firstLevel[leafIndex]
  if (!leafHash) {
    return null
  }

  const proof: MerkleProof['proof'] = []
  let currentIndex = leafIndex

  // Traverse up the tree
  for (let level = 0; level < tree.length - 1; level++) {
    const currentLevel = tree[level]
    if (!currentLevel) continue

    const isLeftNode = currentIndex % 2 === 0
    const siblingIndex = isLeftNode ? currentIndex + 1 : currentIndex - 1

    const currentHash = currentLevel[currentIndex]
    if (!currentHash) continue

    if (siblingIndex >= 0 && siblingIndex < currentLevel.length) {
      const siblingHash = currentLevel[siblingIndex]
      if (siblingHash) {
        proof.push({
          hash: siblingHash,
          position: isLeftNode ? 'right' : 'left',
        })
      } else {
        // Odd node case - sibling is itself
        proof.push({
          hash: currentHash,
          position: 'right',
        })
      }
    } else {
      // Odd node case - sibling is itself
      proof.push({
        hash: currentHash,
        position: 'right',
      })
    }

    // Move to parent index
    currentIndex = Math.floor(currentIndex / 2)
  }

  const lastLevel = tree[tree.length - 1]
  if (!lastLevel || lastLevel.length === 0) {
    return null
  }
  const root = lastLevel[0]
  if (!root) {
    return null
  }

  return {
    leaf: leafHash,
    leafIndex,
    proof,
    root,
  }
}

/**
 * Verify a merkle proof
 */
export function verifyMerkleProof(proof: MerkleProof): boolean {
  let currentHash = proof.leaf

  for (const step of proof.proof) {
    if (step.position === 'left') {
      currentHash = hashPair(step.hash, currentHash)
    } else {
      currentHash = hashPair(currentHash, step.hash)
    }
  }

  return currentHash === proof.root
}

/**
 * Verify that a leaf is included in the tree with given root
 */
export function verifyLeafInclusion(
  leaf: MerkleLeaf,
  leafIndex: number,
  proof: MerkleProof['proof'],
  expectedRoot: string
): boolean {
  const leafHash = computeLeafHash(leaf)
  let currentHash = leafHash

  for (const step of proof) {
    if (step.position === 'left') {
      currentHash = hashPair(step.hash, currentHash)
    } else {
      currentHash = hashPair(currentHash, step.hash)
    }
  }

  return currentHash === expectedRoot
}

/**
 * Format merkle root for payload (32 bytes hex)
 */
export function formatMerkleRootForPayload(root: string): string {
  // Ensure it's 64 hex chars (32 bytes)
  return root.toLowerCase().padStart(64, '0').slice(0, 64)
}

/**
 * Create commit payload for merkle root
 * Format: "TKCommit|v1|{saleId}|{merkleRoot}"
 */
export function createCommitPayload(saleId: string, merkleRoot: string): string {
  const payload = `TKCommit|v1|${saleId}|${merkleRoot}`
  // Convert to hex
  return Buffer.from(payload, 'utf-8').toString('hex')
}

/**
 * Parse commit payload
 */
export function parseCommitPayload(
  payloadHex: string
): { saleId: string; merkleRoot: string } | null {
  try {
    const payload = Buffer.from(payloadHex, 'hex').toString('utf-8')
    const parts = payload.split('|')

    if (parts.length !== 4) {
      return null
    }

    const [magic, version, saleId, merkleRoot] = parts
    if (magic !== 'TKCommit' || version !== 'v1' || !saleId || !merkleRoot) {
      return null
    }

    return { saleId, merkleRoot }
  } catch {
    return null
  }
}
