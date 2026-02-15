import { createConfig } from "ponder";
import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ERC20Abi } from "./abis/ERC20Abi";
import { TickastingSaleAbi } from "./abis/TickastingSaleAbi";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../../.env") });
loadEnv({ path: resolve(__dirname, "../../.env.local"), override: true });

const KASPLEX_TESTNET_CHAIN_ID = 167012;
const PONDER_RPC_URL = process.env.PONDER_RPC_URL_167012;
const PAYMENT_TOKEN_ADDRESS =
  (process.env.PAYMENT_TOKEN_ADDRESS as `0x${string}`) ||
  "0x593Cd4124ffE9D11B3114259fbC170a5759E0f54";
const USDC_TRANSFER_START_BLOCK = Number(
  process.env.USDC_TRANSFER_START_BLOCK || process.env.TICKASTING_START_BLOCK || "0"
);

if (!PONDER_RPC_URL) {
  throw new Error("Missing required env: PONDER_RPC_URL_167012");
}

export default createConfig({
  database: {
    kind: "postgres",
    connectionString: process.env.DATABASE_URL,
  },
  chains: {
    kasplexTestnet: {
      id: KASPLEX_TESTNET_CHAIN_ID,
      rpc: PONDER_RPC_URL,
    },
  },
  contracts: {
    TickastingSale: {
      chain: "kasplexTestnet",
      abi: TickastingSaleAbi,
      address: (process.env.TICKASTING_CONTRACT_ADDRESS as `0x${string}`) ||
        "0x0000000000000000000000000000000000000000",
      startBlock: Number(process.env.TICKASTING_START_BLOCK || "0"),
    },
    PaymentToken: {
      chain: "kasplexTestnet",
      abi: ERC20Abi,
      address: PAYMENT_TOKEN_ADDRESS,
      startBlock: USDC_TRANSFER_START_BLOCK,
    },
  },
});
