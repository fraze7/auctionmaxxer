// Starts the HTTP API: npm run api
// A separate process from the collector; WAL mode lets both use the database.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createApp } from "./api.js";
import { loadConfig } from "./config.js";
import { openDb } from "./db.js";
import { log } from "./job.js";

const config = loadConfig();
const db = openDb(config.DB_PATH);
// Without a built web app the server runs as an API only.
const webDir = fileURLToPath(new URL("../../web/dist/", import.meta.url));
const hasWeb = existsSync(webDir);

const app = createApp({
  db,
  defaultHouseId: config.HOUSE_ID,
  // Only whether a webhook is set; the address stays with the collector.
  discordConfigured: config.DISCORD_WEBHOOK_URL !== undefined,
  ...(hasWeb ? { webDir } : {}),
});

// 127.0.0.1 by default: reachable only from this machine (Caddy, or an SSH tunnel).
const server = app.listen(config.API_PORT, config.API_HOST, () => {
  log(`API listening on http://${config.API_HOST}:${config.API_PORT}` + (hasWeb ? " (serving the web app too)" : " (API only: web/dist not built)"));
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    log("API stopping.");
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
