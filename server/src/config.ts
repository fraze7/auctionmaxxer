import "dotenv/config"; // loads server/.env into process.env
import { z } from "zod";
import type { DataSource } from "./dataSource.js";
import { ForeverSource } from "./foreverSource.js";
import { MockSource } from "./mockSource.js";
import { WEBHOOK_PATTERN } from "./notify.js";

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
  // Where the HTTP API listens. 127.0.0.1 = this machine only (not the internet).
  API_HOST: z.string().min(1).default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  // Where watchlist alerts are sent. Optional: without it alerts still show
  // on the site. It's a secret (anyone holding it can post to the channel),
  // set on the server with: ssh -t auctionmaxxer auctionmaxxer-set-webhook
  DISCORD_WEBHOOK_URL: optionalText(z.string().regex(WEBHOOK_PATTERN, "must be a Discord webhook address")),
  // The site's public address, used to make item names in alerts clickable.
  SITE_URL: optionalText(z.string().regex(/^https?:\/\/[^\s/]+$/, "must look like https://example.com")),
});

// A line like `SITE_URL=` in .env arrives as an empty string. Treat that the
// same as the line not being there at all.
function optionalText<S extends z.ZodType>(schema: S) {
  return z.preprocess((value) => (value === "" ? undefined : value), schema.optional());
}

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
