import { createConfig } from "ponder";
import { TickastingSaleAbi } from "./abis/TickastingSaleAbi";

const KASPLEX_TESTNET_CHAIN_ID = 167012;
const PONDER_RPC_URL = process.env.PONDER_RPC_URL_167012;

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
  },
});
