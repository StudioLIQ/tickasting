import { HardhatUserConfig } from 'hardhat/config'
import '@nomicfoundation/hardhat-toolbox'

const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || '0x' + '0'.repeat(64)
const CONTRACT_RPC_URL = process.env.CONTRACT_RPC_URL || ''

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {},
    kasplexTestnet: {
      url: CONTRACT_RPC_URL,
      accounts: DEPLOYER_PRIVATE_KEY !== '0x' + '0'.repeat(64) ? [DEPLOYER_PRIVATE_KEY] : [],
      chainId: 167012,
    },
  },
  paths: {
    sources: './contracts',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts',
  },
}

export default config
