import { ethers } from 'hardhat'

async function main() {
  const [deployer] = await ethers.getSigners()
  console.log('Deploying TickastingSale with account:', deployer.address)

  const balance = await ethers.provider.getBalance(deployer.address)
  console.log('Account balance:', ethers.formatEther(balance), 'ETH')

  const TickastingSale = await ethers.getContractFactory('TickastingSale')
  const contract = await TickastingSale.deploy()
  await contract.waitForDeployment()

  const address = await contract.getAddress()
  console.log('TickastingSale deployed to:', address)
  console.log('')
  console.log('Add to your .env:')
  console.log(`TICKASTING_CONTRACT_ADDRESS=${address}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
