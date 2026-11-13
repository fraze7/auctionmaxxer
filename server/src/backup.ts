import { createReadStream, createWriteStream, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import type { Db } from "./db.js";

// Makes a dated, gzipped copy of the database and deletes old copies.
// VACUUM INTO gives a consistent copy even while the collector is writing.

export const DEFAULT_KEEP = 14; // two weeks of nightly backups

const BACKUP_NAME = /^auctionmaxxer-\d{4}-\d{2}-\d{2}\.db\.gz$/;

export interface BackupOptions {
  db: Db;
  dir: string; // folder the backups live in; created if missing
  keep?: number; // how many of the newest backups to keep
  now?: () => Date; // only tests pass this
}

export interface BackupResult {
  file: string; // full path of the new backup
  deleted: string[]; // names of old backups that were removed
}

export async function backupDatabase(options: BackupOptions): Promise<BackupResult> {
  const { db, dir } = options;
  const keep = options.keep ?? DEFAULT_KEEP;
  const date = (options.now ?? (() => new Date()))().toISOString().slice(0, 10); // YYYY-MM-DD, UTC

  mkdirSync(dir, { recursive: true });
  const plain = join(dir, `auctionmaxxer-${date}.db`);
  const file = `${plain}.gz`;

  // VACUUM INTO won't overwrite; a same-day backup replaces the earlier one.
  rmSync(plain, { force: true });
  db.prepare("VACUUM INTO ?").run(plain);

  await pipeline(createReadStream(plain), createGzip(), createWriteStream(file));
  rmSync(plain);

  // Dated names sort as text, so newest is last.
  const backups = readdirSync(dir)
    .filter((name) => BACKUP_NAME.test(name))
    .sort();
  const deleted = backups.slice(0, Math.max(0, backups.length - keep));
  for (const name of deleted) {
    rmSync(join(dir, name));
  }

  return { file, deleted };
}
