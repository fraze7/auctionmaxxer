// The long-running collector. Run with: npm start   (stop with Ctrl+C)
//
// Blizzard publishes one snapshot an hour, but not at a fixed minute: it was
// 12 past on 9 Nov 2026 and 25 past on 12 Nov. So instead of guessing the
// minute, we ask every 10 minutes. Asking is cheap - when there's nothing new
// Blizzard answers "304 Not Modified" with no body - and a new snapshot is
// picked up at most 10 minutes after it appears.
//
// History is only collected while this is running. If the PC sleeps or this
// window is closed, those hours are gone for good.
import { schedule } from "node-cron";
import { createSource, loadConfig } from "./config.js";
import { openDb } from "./db.js";
import { log, runJob } from "./job.js";

// Cron fields: minute hour day-of-month month day-of-week.
// "*/10 * * * *" = at minutes 0, 10, 20, 30, 40, 50 of every hour.
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
    });
  } catch (err) {
    // runJob records ordinary failures itself. Anything that still gets here
    // (say, the disk is full) is logged, and the schedule carries on: one bad
    // run must not kill the collector for the rest of the night.
    log("Run crashed:", err instanceof Error ? (err.stack ?? err.message) : String(err));
  }
}

log(`Collector started: house ${config.HOUSE_ID}, source "${config.DATA_SOURCE}", database ${config.DB_PATH}`);
log("Checking for a new snapshot every 10 minutes. Press Ctrl+C to stop.");

// Once right away, so a restart doesn't wait up to 10 minutes.
await tick(true);

// noOverlap: if a run is somehow still going when the next one is due, skip
// that one instead of running two at once.
const task = schedule(EVERY_TEN_MINUTES, () => tick(false), { noOverlap: true });

// Ctrl+C: stop the schedule and close the database cleanly.
process.on("SIGINT", () => {
  log("Stopping.");
  void task.stop();
  db.close();
  process.exit(0);
});
