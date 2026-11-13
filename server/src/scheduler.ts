// The long-running collector: npm start
// Blizzard publishes hourly but not at a fixed minute, so we ask every 10
// minutes. Asking is cheap: nothing new means a 304 with no body.
import { schedule } from "node-cron";
import { createSource, loadConfig } from "./config.js";
import { openDb } from "./db.js";
import { log, runJob } from "./job.js";

const EVERY_TEN_MINUTES = "*/10 * * * *";

const config = loadConfig();
const source = createSource(config); // kept for the whole run, so its token is reused
const db = openDb(config.DB_PATH);

async function tick(logSkipped: boolean): Promise<void> {
  try {
    await runJob({
      db,
      source,
      rulesetId: config.RULESET_ID,
      houseId: config.HOUSE_ID,
      logSkipped,
      discordWebhookUrl: config.DISCORD_WEBHOOK_URL,
      siteUrl: config.SITE_URL,
    });
  } catch (err) {
    // Anything runJob didn't handle itself: log it and keep the schedule running.
    log("Run crashed:", err instanceof Error ? (err.stack ?? err.message) : String(err));
  }
}

log(`Collector started: house ${config.HOUSE_ID}, source "${config.DATA_SOURCE}", database ${config.DB_PATH}`);
log("Checking for a new snapshot every 10 minutes. Press Ctrl+C to stop.");
log(config.DISCORD_WEBHOOK_URL ? "Watchlist alerts go to Discord." : "No Discord webhook set: alerts show on the site only.");

// Once right away, so a restart doesn't wait.
await tick(true);

// noOverlap: never run two at once.
const task = schedule(EVERY_TEN_MINUTES, () => tick(false), { noOverlap: true });

// Stop cleanly on Ctrl+C (SIGINT) and systemd's SIGTERM.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    log("Stopping.");
    void task.stop();
    db.close();
    process.exit(0);
  });
}
