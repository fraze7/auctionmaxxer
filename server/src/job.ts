import { backfillItems } from "./backfill.js";
import { collectOnce } from "./collector.js";
import type { DataSource } from "./dataSource.js";
import type { Db } from "./db.js";
import { sendPendingAlerts } from "./notify.js";
import { recordRecommendations } from "./record.js";
import { pruneOldLevels } from "./retention.js";
import { loadSettings } from "./settings.js";
import { checkWatches } from "./watchlist.js";

// One full run: collect, check the watchlist, send alerts, look up item names.
// Shared by `npm run collect` and `npm start`. Returns false if the collect failed.

export interface JobOptions {
  db: Db;
  source: DataSource;
  rulesetId: number;
  houseId: number;
  // Log "nothing new" too. The scheduler turns this off.
  logSkipped?: boolean;
  // Left out = alerts only show on the site.
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

  if (result.status === "ok") {
    const pruned = pruneOldLevels({ db });
    if (pruned > 0) log(`Pruned ${pruned} old price-level rows`);

    const raised = checkWatches({ db, houseId });
    if (raised > 0) log(`Watchlist: ${raised} new alert${raised === 1 ? "" : "s"}`);

    // For the track record. A failure here is logged but never fails the run.
    try {
      const saved = recordRecommendations({ db, houseId, settings: loadSettings(db) });
      if (saved > 0) log(`Track record: saved ${saved} new pick${saved === 1 ? "" : "s"}`);
    } catch (err) {
      log(`Track record: saving failed (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  // Every tick, so rules added on the site and failed sends are picked up.
  // A failure is logged but never fails the run.
  if (options.discordWebhookUrl) {
    const result = await sendPendingAlerts({ db, webhookUrl: options.discordWebhookUrl, siteUrl: options.siteUrl });
    if (result.sent > 0) log(`Discord: sent ${result.sent} alert${result.sent === 1 ? "" : "s"}`);
    if (result.error) log(`Discord: sending failed, will retry next run (${result.error})`);
  }

  // A failure here is logged but never fails the run.
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
