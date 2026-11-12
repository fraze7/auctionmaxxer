// Backs up the database once and exits. Run with: npm run backup
// On the server a systemd timer runs this every night.
import { dirname, join } from "node:path";
import { backupDatabase } from "./backup.js";
import { loadConfig } from "./config.js";
import { openDb } from "./db.js";
import { log } from "./job.js";

const config = loadConfig();
const db = openDb(config.DB_PATH);
try {
  // Backups go in a "backups" folder next to the database file.
  const { file, deleted } = await backupDatabase({ db, dir: join(dirname(config.DB_PATH), "backups") });
  log(`Backup written: ${file}` + (deleted.length ? ` (removed ${deleted.length} old)` : ""));
} finally {
  db.close();
}
