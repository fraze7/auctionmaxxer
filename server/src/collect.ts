// Runs the collector once and prints what happened. Run with: npm run collect
// The hourly schedule (node-cron) comes later and will call the same function.
import "dotenv/config"; // loads server/.env into process.env
import { z } from "zod";
import { collectOnce } from "./collector.js";
import type { DataSource } from "./dataSource.js";
import { openDb } from "./db.js";
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
const env = EnvSchema.parse(process.env);

function createSource(kind: typeof env.DATA_SOURCE): DataSource {
  switch (kind) {
    case "mock":
      return new MockSource();
    case "forever":
      if (!env.BLIZZARD_CLIENT_ID || !env.BLIZZARD_CLIENT_SECRET) {
        throw new Error("DATA_SOURCE=forever needs BLIZZARD_CLIENT_ID and BLIZZARD_CLIENT_SECRET in .env");
      }
      return new ForeverSource({
        clientId: env.BLIZZARD_CLIENT_ID,
        clientSecret: env.BLIZZARD_CLIENT_SECRET,
        rulesetId: env.RULESET_ID,
      });
    case "retail":
      throw new Error("DATA_SOURCE=retail is not built yet - use mock or forever");
  }
}

const db = openDb(env.DB_PATH);
try {
  const result = await collectOnce({
    db,
    source: createSource(env.DATA_SOURCE),
    rulesetId: env.RULESET_ID,
    houseId: env.HOUSE_ID,
  });

  const when = (unixSeconds: number) => new Date(unixSeconds * 1000).toISOString();
  switch (result.status) {
    case "ok":
    case "empty":
      console.log(
        `Stored snapshot #${result.snapshotId} (${result.status}), taken ${when(result.takenAt)}:`,
        `${result.listingCount} listings -> ${result.itemCount} items`,
      );
      break;
    case "skipped":
      console.log(`Nothing new: already have the snapshot taken ${when(result.lastTakenAt)}`);
      break;
    case "failed":
      console.error(`Collect failed (recorded as snapshot #${result.snapshotId}): ${result.error}`);
      process.exitCode = 1; // lets a scheduler or script see that the run failed
      break;
  }
} finally {
  db.close();
}
