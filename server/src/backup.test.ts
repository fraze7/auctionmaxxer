// Tests for the database backup. Uses a real temporary folder, removed afterwards.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { gunzipSync } from "node:zlib";
import Database from "better-sqlite3";
import { backupDatabase } from "./backup.js";
import { openDb } from "./db.js";

function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "auctionmaxxer-backup-"));
  return run(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

const on = (date: string) => () => new Date(`${date}T03:40:00Z`);

describe("backupDatabase", () => {
  it("writes a compressed copy that opens as a database with the same data", () =>
    withTempDir(async (dir) => {
      const db = openDb(join(dir, "live.db"));
      db.prepare("INSERT INTO items (item_id, name, status, first_seen) VALUES (2447, 'Peacebloom', 'ok', 1)").run();

      const result = await backupDatabase({ db, dir: join(dir, "backups"), now: on("2026-11-13") });
      db.close();

      assert.equal(result.file, join(dir, "backups", "auctionmaxxer-2026-11-13.db.gz"));
      assert.deepEqual(readdirSync(join(dir, "backups")), ["auctionmaxxer-2026-11-13.db.gz"]);

      // Unzip it and read it back like a restore would.
      const restoredPath = join(dir, "restored.db");
      writeFileSync(restoredPath, gunzipSync(readFileSync(result.file)));
      const restored = new Database(restoredPath, { readonly: true });
      assert.deepEqual(restored.prepare("SELECT name FROM items").all(), [{ name: "Peacebloom" }]);
      restored.close();
    }));

  it("replaces an earlier backup from the same day", () =>
    withTempDir(async (dir) => {
      const db = openDb(":memory:");
      await backupDatabase({ db, dir, now: on("2026-11-13") });
      await backupDatabase({ db, dir, now: on("2026-11-13") });
      assert.deepEqual(readdirSync(dir), ["auctionmaxxer-2026-11-13.db.gz"]);
    }));

  it("keeps only the newest backups and leaves other files alone", () =>
    withTempDir(async (dir) => {
      const db = openDb(":memory:");
      writeFileSync(join(dir, "notes.txt"), "not a backup");
      await backupDatabase({ db, dir, keep: 2, now: on("2026-11-11") });
      await backupDatabase({ db, dir, keep: 2, now: on("2026-11-12") });

      const result = await backupDatabase({ db, dir, keep: 2, now: on("2026-11-13") });

      assert.deepEqual(result.deleted, ["auctionmaxxer-2026-11-11.db.gz"]);
      assert.deepEqual(readdirSync(dir).sort(), [
        "auctionmaxxer-2026-11-12.db.gz",
        "auctionmaxxer-2026-11-13.db.gz",
        "notes.txt",
      ]);
    }));
});
