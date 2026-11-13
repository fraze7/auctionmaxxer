import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

// The one place that opens the database. Tests pass ":memory:".

export type Db = Database.Database;

const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations/", import.meta.url));

export function openDb(path: string): Db {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);

  // WAL lets the API read while the collector writes.
  db.pragma("journal_mode = WAL");
  // Foreign keys are off by default and the setting is per connection.
  db.pragma("foreign_keys = ON");

  migrate(db);
  return db;
}

// Applies migrations/*.sql not yet recorded in schema_migrations, in name order.
// Never edit a migration that has run: add a new numbered file.
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

  const isApplied = db.prepare<[string], { n: number }>(
    "SELECT COUNT(*) AS n FROM schema_migrations WHERE name = ?",
  );

  for (const file of files) {
    if (alreadyApplied.has(file)) continue;
    const sql = readFileSync(join(dir, file), "utf8");
    // One transaction per file. .immediate() takes the write lock first, because the
    // collector and API both migrate at start-up: the second waits, then re-checks.
    const ran = db
      .transaction(() => {
        if (isApplied.get(file)?.n) return false;
        db.exec(sql);
        record.run(file, Math.floor(Date.now() / 1000));
        return true;
      })
      .immediate();
    if (ran) applied.push(file);
  }
  return applied;
}
