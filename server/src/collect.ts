// Runs the collector once and exits: npm run collect
import { createSource, loadConfig } from "./config.js";
import { openDb } from "./db.js";
import { runJob } from "./job.js";

const config = loadConfig();
const source = createSource(config);
const db = openDb(config.DB_PATH);
try {
  const ok = await runJob({
    db,
    source,
    rulesetId: config.RULESET_ID,
    houseId: config.HOUSE_ID,
    discordWebhookUrl: config.DISCORD_WEBHOOK_URL,
    siteUrl: config.SITE_URL,
  });
  if (!ok) process.exitCode = 1; // lets a script see that the run failed
} finally {
  db.close();
}
