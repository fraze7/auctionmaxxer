import "dotenv/config"; // loads server/.env into process.env
import { z } from "zod";
import type { DataSource } from "./dataSource.js";
import { ForeverSource } from "./foreverSource.js";
import { MockSource } from "./mockSource.js";
import { WEBHOOK_PATTERN } from "./notify.js";

// Validate .env at start-up so a typo fails with a clear message.
const EnvSchema = z.object({
  RULESET_ID: z.coerce.number().int().positive(),
  HOUSE_ID: z.coerce.number().int().positive(),
  DATA_SOURCE: z.enum(["mock", "forever", "retail"]),
  // Only needed for DATA_SOURCE=forever.
  BLIZZARD_CLIENT_ID: z.string().optional(),
  BLIZZARD_CLIENT_SECRET: z.string().optional(),
  // Relative to server/.
  DB_PATH: z.string().min(1).default("data/auctionmaxxer.db"),
  // 127.0.0.1 = this machine only.
  API_HOST: z.string().min(1).default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  // Optional and secret. Set with: ssh -t auctionmaxxer auctionmaxxer-set-webhook
  DISCORD_WEBHOOK_URL: optionalText(z.string().regex(WEBHOOK_PATTERN, "must be a Discord webhook address")),
  // Makes item names in alerts clickable.
  SITE_URL: optionalText(z.string().regex(/^https?:\/\/[^\s/]+$/, "must look like https://example.com")),
});

// Treat an empty value (`SITE_URL=`) as not set.
function optionalText<S extends z.ZodType>(schema: S) {
  return z.preprocess((value) => (value === "" ? undefined : value), schema.optional());
}

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(): Config {
  return EnvSchema.parse(process.env);
}

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
