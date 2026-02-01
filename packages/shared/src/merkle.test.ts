/**
 * Merkle Tree Tests
 */

import { describe, it, expect } from 'vitest'
import {
  computeLeafHash,
  buildMerkleTree,
  computeMerkleRoot,
  generateMerkleProof,
  verifyMerkleProof,
  verifyLeafInclusion,
  createCommitPayload,
  parseCommitPayload,
  type MerkleLeaf,
} from './merkle.js'

const sampleLeaves: MerkleLeaf[] = [
  {
    finalRank: 1,
    txid: 'abc123def456abc123def456abc123def456abc123def456abc123def456abc1',
    acceptingBlockHash: 'block1hash000000000000000000000000000000000000000000000000',
    acceptingBlueScore: '1000',
    buyerAddrHash: 'buyer1hash00000000000000000000000000000000',
  },
  {
    finalRank: 2,
    txid: 'def456abc123def456abc123def456abc123def456abc123def456abc123def4',
    acceptingBlockHash: 'block2hash000000000000000000000000000000000000000000000000',
    acceptingBlueScore: '1001',
    buyerAddrHash: 'buyer2hash00000000000000000000000000000000',
  },
  {
    finalRank: 3,
    txid: 'ghi789abc123def456abc123def456abc123def456abc123def456abc123ghi7',
    acceptingBlockHash: 'block2hash000000000000000000000000000000000000000000000000',
    acceptingBlueScore: '1001',
    buyerAddrHash: 'buyer3hash00000000000000000000000000000000',
  },
]

describe('merkle', () => {
  describe('computeLeafHash', () => {
    it('should compute consistent hash for same leaf', () => {
      const hash1 = computeLeafHash(sampleLeaves[0])
      const hash2 = computeLeafHash(sampleLeaves[0])
      expect(hash1).toBe(hash2)
    })

    it('should compute different hashes for different leaves', () => {
      const hash1 = computeLeafHash(sampleLeaves[0])
      const hash2 = computeLeafHash(sampleLeaves[1])
      expect(hash1).not.toBe(hash2)
    })

    it('should handle null values', () => {
      const leaf: MerkleLeaf = {
        finalRank: 1,
        txid: 'test123',
        acceptingBlockHash: null,
        acceptingBlueScore: null,
        buyerAddrHash: null,
      }
      const hash = computeLeafHash(leaf)
      expect(hash).toBeDefined()
      expect(hash.length).toBe(64) // SHA256 hex
    })
  })

  describe('buildMerkleTree', () => {
    it('should handle empty leaves', () => {
      const tree = buildMerkleTree([])
      expect(tree.length).toBe(1)
      expect(tree[0].length).toBe(1)
    })

    it('should handle single leaf', () => {
      const tree = buildMerkleTree([sampleLeaves[0]])
      expect(tree.length).toBe(1) // Only leaf level (root is computed by duplicating)
      expect(tree[0].length).toBe(1)
    })

    it('should handle two leaves', () => {
      const tree = buildMerkleTree(sampleLeaves.slice(0, 2))
      expect(tree.length).toBe(2) // leaves + root
      expect(tree[0].length).toBe(2)
      expect(tree[1].length).toBe(1)
    })

    it('should handle three leaves (odd)', () => {
      const tree = buildMerkleTree(sampleLeaves)
      expect(tree.length).toBe(3) // leaves + intermediate + root
      expect(tree[0].length).toBe(3)
      expect(tree[1].length).toBe(2)
      expect(tree[2].length).toBe(1)
    })
  })

  describe('computeMerkleRoot', () => {
    it('should compute consistent root', () => {
      const root1 = computeMerkleRoot(sampleLeaves)
      const root2 = computeMerkleRoot(sampleLeaves)
      expect(root1).toBe(root2)
    })

    it('should produce different root for different leaves', () => {
      const root1 = computeMerkleRoot(sampleLeaves.slice(0, 2))
      const root2 = computeMerkleRoot(sampleLeaves)
      expect(root1).not.toBe(root2)
    })

    it('should be order-dependent', () => {
      const root1 = computeMerkleRoot(sampleLeaves)
      const root2 = computeMerkleRoot([...sampleLeaves].reverse())
      expect(root1).not.toBe(root2)
    })
  })

  describe('generateMerkleProof', () => {
    it('should generate valid proof for first leaf', () => {
      const proof = generateMerkleProof(sampleLeaves, 0)
      expect(proof).not.toBeNull()
      expect(proof!.leafIndex).toBe(0)
      expect(proof!.proof.length).toBeGreaterThan(0)
    })

    it('should generate valid proof for middle leaf', () => {
      const proof = generateMerkleProof(sampleLeaves, 1)
      expect(proof).not.toBeNull()
      expect(proof!.leafIndex).toBe(1)
    })

    it('should generate valid proof for last leaf', () => {
      const proof = generateMerkleProof(sampleLeaves, 2)
      expect(proof).not.toBeNull()
      expect(proof!.leafIndex).toBe(2)
    })

    it('should return null for invalid index', () => {
      expect(generateMerkleProof(sampleLeaves, -1)).toBeNull()
      expect(generateMerkleProof(sampleLeaves, 10)).toBeNull()
    })
  })

  describe('verifyMerkleProof', () => {
    it('should verify valid proof', () => {
      const proof = generateMerkleProof(sampleLeaves, 0)
      expect(proof).not.toBeNull()
      expect(verifyMerkleProof(proof!)).toBe(true)
    })

    it('should verify all proofs in tree', () => {
      for (let i = 0; i < sampleLeaves.length; i++) {
        const proof = generateMerkleProof(sampleLeaves, i)
        expect(proof).not.toBeNull()
        expect(verifyMerkleProof(proof!)).toBe(true)
      }
    })

    it('should reject tampered proof', () => {
      const proof = generateMerkleProof(sampleLeaves, 0)
      expect(proof).not.toBeNull()

      // Tamper with the leaf hash
      const tamperedProof = {
        ...proof!,
        leaf: 'tampered' + proof!.leaf.slice(8),
      }
      expect(verifyMerkleProof(tamperedProof)).toBe(false)
    })
  })

  describe('verifyLeafInclusion', () => {
    it('should verify leaf is included', () => {
      const root = computeMerkleRoot(sampleLeaves)
      const proof = generateMerkleProof(sampleLeaves, 1)
      expect(proof).not.toBeNull()

      const isValid = verifyLeafInclusion(
        sampleLeaves[1],
        1,
        proof!.proof,
        root
      )
      expect(isValid).toBe(true)
    })

    it('should reject modified leaf', () => {
      const root = computeMerkleRoot(sampleLeaves)
      const proof = generateMerkleProof(sampleLeaves, 1)
      expect(proof).not.toBeNull()

      const modifiedLeaf = { ...sampleLeaves[1], finalRank: 999 }
      const isValid = verifyLeafInclusion(
        modifiedLeaf,
        1,
        proof!.proof,
        root
      )
      expect(isValid).toBe(false)
    })
  })

  describe('commit payload', () => {
    const saleId = '123e4567-e89b-12d3-a456-426614174000'
    const merkleRoot = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'

    it('should create and parse commit payload', () => {
      const payload = createCommitPayload(saleId, merkleRoot)
      expect(payload).toBeDefined()
      expect(payload.length).toBeGreaterThan(0)

      const parsed = parseCommitPayload(payload)
      expect(parsed).not.toBeNull()
      expect(parsed!.saleId).toBe(saleId)
      expect(parsed!.merkleRoot).toBe(merkleRoot)
    })

    it('should return null for invalid payload', () => {
      expect(parseCommitPayload('')).toBeNull()
      expect(parseCommitPayload('invalid')).toBeNull()
      expect(parseCommitPayload(Buffer.from('wrong|format').toString('hex'))).toBeNull()
    })
  })
})
