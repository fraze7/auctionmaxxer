import { backfillItems } from "./backfill.js";
import { collectOnce } from "./collector.js";
import type { DataSource } from "./dataSource.js";
import type { Db } from "./db.js";

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
