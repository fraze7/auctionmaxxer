import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

// The one place that opens the database. Everything else receives a `Db` and
// never cares where the file lives - tests pass ":memory:" for a throwaway
// database that exists only while the test runs.

export type Db = Database.Database;

const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations/", import.meta.url));

// Opens (or creates) the database and brings its schema up to date.
export function openDb(path: string): Db {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);

  // WAL lets the API read while the collector writes, instead of blocking.
  db.pragma("journal_mode = WAL");
  // SQLite ignores foreign keys unless asked, and the setting is per
  // connection - so it has to be switched on here, every time we open.
  db.pragma("foreign_keys = ON");

  migrate(db);
  return db;
}

// Runs every .sql file in migrations/ that this database hasn't seen yet, in
// file-name order (001_, 002_, ...). Returns the names it applied.
//
// A migration file is never edited once it has run somewhere: to change the
// schema, add a new numbered file. The schema_migrations table is how each
// database remembers which files it already has.
export function migrate(db: Db, dir: string = MIGRATIONS_DIR): string[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    ) STRICT
  `);

  const alreadyApplied = new Set(
    db
      .prepare<[], { name: string }>("SELECT name FROM schema_migrations")
      .all()
      .map((row) => row.name),
  );
  const record = db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)");

  const applied: string[] = [];
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (alreadyApplied.has(file)) continue;
    const sql = readFileSync(join(dir, file), "utf8");
    // One transaction per file: a migration either fully applies and is
    // recorded, or leaves no trace. Never half a schema.
    db.transaction(() => {
      db.exec(sql);
      record.run(file, Math.floor(Date.now() / 1000));
    })();
    applied.push(file);
  }
  return applied;
}
