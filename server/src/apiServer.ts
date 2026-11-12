// Starts the HTTP API. Run with: npm run api   (stop with Ctrl+C)
//
// It runs as its own process, separate from the collector: they share the
// SQLite file (WAL mode lets one read while the other writes), and a crash or
// restart of one doesn't disturb the other.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createApp } from "./api.js";
import { loadConfig } from "./config.js";
import { openDb } from "./db.js";
import { log } from "./job.js";

const config = loadConfig();
const db = openDb(config.DB_PATH);
// The web app, once it has been built (cd web && npm run build). If the folder
// isn't there the server still runs, as an API only.
const webDir = fileURLToPath(new URL("../../web/dist/", import.meta.url));
const hasWeb = existsSync(webDir);

const app = createApp({ db, defaultHouseId: config.HOUSE_ID, ...(hasWeb ? { webDir } : {}) });

// API_HOST defaults to 127.0.0.1: only programs on the same machine can
// connect. On the server that keeps the API off the public internet; you
// reach it from your PC through an SSH tunnel instead:
//   ssh -N -L 3001:127.0.0.1:3001 auctionmaxxer
// and then open http://localhost:3001/api/status
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
