import { backfillItems } from "./backfill.js";
import { collectOnce } from "./collector.js";
import type { DataSource } from "./dataSource.js";
import type { Db } from "./db.js";
import { sendPendingAlerts } from "./notify.js";
import { pruneOldLevels } from "./retention.js";
import { checkWatches } from "./watchlist.js";

// One full run: collect the latest snapshot, then look up a batch of item
// names. Both `npm run collect` (once) and `npm start` (on a schedule) call
// this, so they can never drift apart.
//
// Returns false if the collect failed, so a caller can set an exit code.

export interface JobOptions {
  db: Db;
  source: DataSource;
  rulesetId: number;
  houseId: number;
  // Print a line even when there was nothing new. The scheduler turns this
  // off: it checks every few minutes and would otherwise flood the log.
  logSkipped?: boolean;
  // Where to send watchlist alerts. Left out = alerts only show on the site.
  discordWebhookUrl?: string | undefined;
  siteUrl?: string | undefined;
}

export async function runJob(options: JobOptions): Promise<boolean> {
  const { db, source, rulesetId, houseId } = options;

  const result = await collectOnce({ db, source, rulesetId, houseId });
  switch (result.status) {
    case "ok":
    case "empty":
      log(
        `Stored snapshot #${result.snapshotId} (${result.status}), taken ${isoTime(result.takenAt)}:`,
        `${result.listingCount} listings -> ${result.itemCount} items`,
      );
      break;
    case "skipped":
      if (options.logSkipped ?? true) {
        log(`Nothing new: already have the snapshot taken ${isoTime(result.lastTakenAt)}`);
      }
      break;
    case "failed":
      log(`Collect FAILED (recorded as snapshot #${result.snapshotId}): ${result.error}`);
      break;
  }

  // After storing something new, clear out order-book rows past their keep time.
  if (result.status === "ok") {
    const pruned = pruneOldLevels({ db });
    if (pruned > 0) log(`Pruned ${pruned} old price-level rows`);

    // New prices: see whether any watchlist rule has just been crossed.
    const raised = checkWatches({ db, houseId });
    if (raised > 0) log(`Watchlist: ${raised} new alert${raised === 1 ? "" : "s"}`);
  }

  // Tell Discord about alerts it hasn't heard of yet. This runs on every
  // tick, not only after a new snapshot, for two reasons: a rule added on the
  // site can fire straight away, and a send that failed gets retried.
  // Like names below, a failure here is logged but never fails the run.
  if (options.discordWebhookUrl) {
    const result = await sendPendingAlerts({ db, webhookUrl: options.discordWebhookUrl, siteUrl: options.siteUrl });
    if (result.sent > 0) log(`Discord: sent ${result.sent} alert${result.sent === 1 ? "" : "s"}`);
    if (result.error) log(`Discord: sending failed, will retry next run (${result.error})`);
  }

  // Names are a nice-to-have: a failure here is logged but never fails the run.
  const names = await backfillItems({ db, source });
  if (names.found + names.missing > 0 || names.error) {
    log(
      `Item names: ${names.found} found, ${names.missing} unknown to Blizzard, ${names.remaining} still queued` +
        (names.error ? ` (stopped early: ${names.error})` : ""),
    );
  }

  return result.status !== "failed";
}

export function log(...parts: string[]): void {
  console.log(`[${new Date().toISOString()}]`, ...parts);
}

function isoTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString();
}
