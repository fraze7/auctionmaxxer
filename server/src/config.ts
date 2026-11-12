import "dotenv/config"; // loads server/.env into process.env
import { z } from "zod";
import type { DataSource } from "./dataSource.js";
import { ForeverSource } from "./foreverSource.js";
import { MockSource } from "./mockSource.js";

// Settings arrive from .env as strings. Checking them here means a typo fails
// at start-up with a clear message, not as a strange bug an hour later.
const EnvSchema = z.object({
  RULESET_ID: z.coerce.number().int().positive(),
  HOUSE_ID: z.coerce.number().int().positive(),
  DATA_SOURCE: z.enum(["mock", "forever", "retail"]),
  // Only needed for DATA_SOURCE=forever, so mock mode runs without credentials.
  BLIZZARD_CLIENT_ID: z.string().optional(),
  BLIZZARD_CLIENT_SECRET: z.string().optional(),
  // Relative to the folder you run from (server/). *.db is git-ignored.
  DB_PATH: z.string().min(1).default("data/auctionmaxxer.db"),
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(): Config {
  return EnvSchema.parse(process.env);
}

// The only place that knows which DataSource implementations exist.
export function createSource(config: Config): DataSource {
  switch (config.DATA_SOURCE) {
    case "mock":
      return new MockSource();
    case "forever":
      if (!config.BLIZZARD_CLIENT_ID || !config.BLIZZARD_CLIENT_SECRET) {
        throw new Error("DATA_SOURCE=forever needs BLIZZARD_CLIENT_ID and BLIZZARD_CLIENT_SECRET in .env");
      }
      return new ForeverSource({
        clientId: config.BLIZZARD_CLIENT_ID,
        clientSecret: config.BLIZZARD_CLIENT_SECRET,
        rulesetId: config.RULESET_ID,
      });
    case "retail":
      throw new Error("DATA_SOURCE=retail is not built yet - use mock or forever");
  }
}
