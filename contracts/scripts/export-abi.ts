import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { resolve } from 'path'

const ARTIFACT_PATH = resolve(
  __dirname,
  '../artifacts/contracts/TickastingSale.sol/TickastingSale.json'
)
const OUTPUT_DIR = resolve(__dirname, '../../packages/shared/abi')
const OUTPUT_PATH = resolve(OUTPUT_DIR, 'TickastingSale.json')

function main() {
  const artifact = JSON.parse(readFileSync(ARTIFACT_PATH, 'utf-8'))

  const output = {
    contractName: artifact.contractName,
    abi: artifact.abi,
    // Exclude bytecode for size — only ABI is needed by frontend/api
  }

  mkdirSync(OUTPUT_DIR, { recursive: true })
  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n')

  console.log(`ABI exported to ${OUTPUT_PATH}`)
  console.log(`  ${artifact.abi.length} ABI entries`)
}

main()
