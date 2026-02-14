import { createConfig } from "ponder";
import { TickastingSaleAbi } from "./abis/TickastingSaleAbi";

export default createConfig({
  database: {
    kind: "postgres",
    connectionString: process.env.DATABASE_URL,
  },
  chains: {
    sepolia: {
      id: 11155111,
      rpc: process.env.PONDER_RPC_URL_11155111,
    },
  },
  contracts: {
    TickastingSale: {
      chain: "sepolia",
      abi: TickastingSaleAbi,
      address: (process.env.TICKASTING_CONTRACT_ADDRESS as `0x${string}`) ||
        "0x0000000000000000000000000000000000000000",
      startBlock: Number(process.env.TICKASTING_START_BLOCK || "0"),
    },
  },
});
