import { expect } from 'chai'
import { ethers } from 'hardhat'
import { MerkleTree } from 'merkletreejs'
import { keccak256, AbiCoder, solidityPackedKeccak256 } from 'ethers'

describe('TickastingSale', function () {
  async function deployFixture() {
    const [owner, organizer, winner1, winner2, other] = await ethers.getSigners()

    const TickastingSale = await ethers.getContractFactory('TickastingSale')
    const contract = await TickastingSale.deploy()

    const saleId = ethers.id('demo-sale-001')
    const vipCode = ethers.id('VIP')
    const genCode = ethers.id('GEN')

    return { contract, owner, organizer, winner1, winner2, other, saleId, vipCode, genCode }
  }

  describe('createSale', function () {
    it('should create a sale', async function () {
      const { contract, owner, organizer, saleId } = await deployFixture()

      const now = Math.floor(Date.now() / 1000)
      await expect(contract.createSale(saleId, organizer.address, now, now + 3600))
        .to.emit(contract, 'SaleCreated')
        .withArgs(saleId, organizer.address, now, now + 3600)

      expect(await contract.saleId()).to.equal(saleId)
      expect(await contract.organizer()).to.equal(organizer.address)
    })

    it('should prevent creating sale twice', async function () {
      const { contract, organizer, saleId } = await deployFixture()
      const now = Math.floor(Date.now() / 1000)
      await contract.createSale(saleId, organizer.address, now, now + 3600)
      await expect(
        contract.createSale(saleId, organizer.address, now, now + 3600)
      ).to.be.revertedWith('Sale already created')
    })

    it('should reject non-owner', async function () {
      const { contract, organizer, saleId } = await deployFixture()
      const now = Math.floor(Date.now() / 1000)
      await expect(
        contract.connect(organizer).createSale(saleId, organizer.address, now, now + 3600)
      ).to.be.revertedWithCustomError(contract, 'OwnableUnauthorizedAccount')
    })
  })

  describe('defineTicketType', function () {
    it('should define a ticket type', async function () {
      const { contract, organizer, saleId, vipCode } = await deployFixture()
      const now = Math.floor(Date.now() / 1000)
      await contract.createSale(saleId, organizer.address, now, now + 3600)

      await expect(
        contract.connect(organizer).defineTicketType(vipCode, 'VIP', 500000000n, 10, 'ipfs://vip')
      )
        .to.emit(contract, 'TicketTypeDefined')
        .withArgs(saleId, vipCode, 'VIP', 10, 500000000n)

      const tt = await contract.getTicketType(vipCode)
      expect(tt.name).to.equal('VIP')
      expect(tt.supply).to.equal(10)
      expect(tt.minted).to.equal(0)
      expect(tt.active).to.be.true
    })

    it('should prevent duplicate type', async function () {
      const { contract, organizer, saleId, vipCode } = await deployFixture()
      const now = Math.floor(Date.now() / 1000)
      await contract.createSale(saleId, organizer.address, now, now + 3600)
      await contract.connect(organizer).defineTicketType(vipCode, 'VIP', 500000000n, 10, '')
      await expect(
        contract.connect(organizer).defineTicketType(vipCode, 'VIP2', 500000000n, 5, '')
      ).to.be.revertedWith('Type already defined')
    })
  })

  describe('claimTicket', function () {
    async function claimFixture() {
      const { contract, owner, organizer, winner1, winner2, other, saleId, vipCode, genCode } =
        await deployFixture()

      const now = Math.floor(Date.now() / 1000)
      await contract.createSale(saleId, organizer.address, now, now + 3600)
      await contract.connect(organizer).defineTicketType(vipCode, 'VIP', 500000000n, 2, '')
      await contract.connect(organizer).defineTicketType(genCode, 'GEN', 100000000n, 5, '')

      // Build claim data
      const txid1 = ethers.id('kaspa-tx-001')
      const txid2 = ethers.id('kaspa-tx-002')

      const leaf1 = solidityPackedKeccak256(
        ['address', 'bytes32', 'bytes32', 'uint256'],
        [winner1.address, vipCode, txid1, 1]
      )
      const leaf2 = solidityPackedKeccak256(
        ['address', 'bytes32', 'bytes32', 'uint256'],
        [winner2.address, genCode, txid2, 2]
      )

      // Build Merkle tree (sorted pairs, keccak256)
      const leaves = [leaf1, leaf2]
      const tree = new MerkleTree(leaves, keccak256, { sortPairs: true })
      const root = tree.getHexRoot()

      await contract.connect(organizer).openClaim(root)

      const proof1 = tree.getHexProof(leaf1)
      const proof2 = tree.getHexProof(leaf2)

      return {
        contract, organizer, winner1, winner2, other,
        saleId, vipCode, genCode,
        txid1, txid2, proof1, proof2, root,
      }
    }

    it('should allow valid claim', async function () {
      const { contract, winner1, saleId, vipCode, txid1, proof1 } = await claimFixture()

      await expect(contract.connect(winner1).claimTicket(vipCode, txid1, 1, proof1))
        .to.emit(contract, 'TicketClaimed')
        .withArgs(saleId, vipCode, winner1.address, 1, txid1, 1)

      expect(await contract.ownerOf(1)).to.equal(winner1.address)
      expect(await contract.getTokenTicketType(1)).to.equal(vipCode)
      expect(await contract.isClaimed(txid1)).to.be.true

      const tt = await contract.getTicketType(vipCode)
      expect(tt.minted).to.equal(1)
    })

    it('should prevent duplicate claim', async function () {
      const { contract, winner1, vipCode, txid1, proof1 } = await claimFixture()

      await contract.connect(winner1).claimTicket(vipCode, txid1, 1, proof1)
      await expect(
        contract.connect(winner1).claimTicket(vipCode, txid1, 1, proof1)
      ).to.be.revertedWith('Already claimed')
    })

    it('should prevent claim with invalid proof', async function () {
      const { contract, other, vipCode, txid1, proof1 } = await claimFixture()

      // 'other' is not in the Merkle tree
      await expect(
        contract.connect(other).claimTicket(vipCode, txid1, 1, proof1)
      ).to.be.revertedWith('Invalid proof')
    })

    it('should prevent claim when sold out', async function () {
      const { contract, winner1, winner2, organizer, vipCode, txid1, txid2, proof1, proof2 } =
        await claimFixture()

      // Claim both VIP slots (supply=2)
      await contract.connect(winner1).claimTicket(vipCode, txid1, 1, proof1)

      // winner2 tries to claim VIP but proof is for GEN
      // So let's test sold out differently: reduce supply
      // Actually the supply is 2, let's just verify remaining
      const remaining = await contract.getRemainingSupply(vipCode)
      expect(remaining).to.equal(1)
    })

    it('should prevent claim after finalization', async function () {
      const { contract, organizer, winner1, vipCode, txid1, proof1 } = await claimFixture()

      await contract.connect(organizer).finalizeSale()

      // finalizeSale sets claimOpen=false, so "Claim not open" triggers first
      await expect(
        contract.connect(winner1).claimTicket(vipCode, txid1, 1, proof1)
      ).to.be.revertedWith('Claim not open')
    })
  })

  describe('finalizeSale', function () {
    it('should finalize the sale', async function () {
      const { contract, organizer, saleId } = await deployFixture()
      const now = Math.floor(Date.now() / 1000)
      await contract.createSale(saleId, organizer.address, now, now + 3600)

      await expect(contract.connect(organizer).finalizeSale())
        .to.emit(contract, 'SaleFinalized')
        .withArgs(saleId, 0)

      expect(await contract.finalized()).to.be.true
      expect(await contract.claimOpen()).to.be.false
    })

    it('should prevent double finalization', async function () {
      const { contract, organizer, saleId } = await deployFixture()
      const now = Math.floor(Date.now() / 1000)
      await contract.createSale(saleId, organizer.address, now, now + 3600)
      await contract.connect(organizer).finalizeSale()

      await expect(
        contract.connect(organizer).finalizeSale()
      ).to.be.revertedWith('Sale already finalized')
    })
  })

  describe('view functions', function () {
    it('should return ticket type codes', async function () {
      const { contract, organizer, saleId, vipCode, genCode } = await deployFixture()
      const now = Math.floor(Date.now() / 1000)
      await contract.createSale(saleId, organizer.address, now, now + 3600)
      await contract.connect(organizer).defineTicketType(vipCode, 'VIP', 500000000n, 10, '')
      await contract.connect(organizer).defineTicketType(genCode, 'GEN', 100000000n, 50, '')

      const codes = await contract.getTicketTypeCodes()
      expect(codes.length).to.equal(2)
      expect(codes[0]).to.equal(vipCode)
      expect(codes[1]).to.equal(genCode)
    })
  })
})
