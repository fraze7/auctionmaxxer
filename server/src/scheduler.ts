// The long-running collector: npm start
// Asks Blizzard just after each hourly update is due (see nextCheck.ts).
// Asking is cheap: nothing new means a 304 with no body.
import { createSource, loadConfig } from "./config.js";
import { latestTakenAt } from "./collector.js";
import { openDb } from "./db.js";
import { log, runJob } from "./job.js";
import { secondsUntilNextCheck } from "./nextCheck.js";

const config = loadConfig();
const source = createSource(config); // kept for the whole run, so its token is reused
const db = openDb(config.DB_PATH);

async function tick(logSkipped: boolean): Promise<boolean> {
  try {
    return await runJob({
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
    return false;
  }
}

log(`Collector started: house ${config.HOUSE_ID}, source "${config.DATA_SOURCE}", database ${config.DB_PATH}`);
log("Checking for a new snapshot just after each hourly update. Press Ctrl+C to stop.");
log(config.DISCORD_WEBHOOK_URL ? "Watchlist alerts go to Discord." : "No Discord webhook set: alerts show on the site only.");

// Once right away, so a restart doesn't wait.
let timer = planNext(await tick(true));

// The next run is only planned once this one ends, so two never overlap.
function planNext(lastRunOk: boolean): NodeJS.Timeout {
  const now = Math.floor(Date.now() / 1000);
  const seconds = secondsUntilNextCheck(now, latestTakenAt(db, config.HOUSE_ID), lastRunOk);
  return setTimeout(() => {
    void tick(false).then((ok) => {
      timer = planNext(ok);
    });
  }, seconds * 1000);
}

// Stop cleanly on Ctrl+C (SIGINT) and systemd's SIGTERM.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    log("Stopping.");
    clearTimeout(timer);
    db.close();
    process.exit(0);
  });
}
