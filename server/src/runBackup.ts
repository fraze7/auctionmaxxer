// Backs up the database once: npm run backup (nightly via a systemd timer).
import { dirname, join } from "node:path";
import { backupDatabase } from "./backup.js";
import { loadConfig } from "./config.js";
import { openDb } from "./db.js";
import { log } from "./job.js";

const config = loadConfig();
const db = openDb(config.DB_PATH);
try {
  // Into a "backups" folder next to the database.
  const { file, deleted } = await backupDatabase({ db, dir: join(dirname(config.DB_PATH), "backups") });
  log(`Backup written: ${file}` + (deleted.length ? ` (removed ${deleted.length} old)` : ""));
} finally {
  db.close();
}
