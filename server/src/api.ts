import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { Db } from "./db.js";
import { findDeals } from "./deals.js";
import { loadSettings } from "./settings.js";

// The HTTP API the web app reads from. It only ever reads our own SQLite
// database - it never calls Blizzard, and it never sees the client secret.
//
// `createApp` builds the Express app but doesn't start listening. That split
// lets tests start it on a throwaway port, and apiServer.ts start it for real.
//
// Conventions:
//   * JSON out is camelCase; prices are integer copper; times are Unix seconds.
//   * Bad input -> 400 with { error }. Unknown thing -> 404 with { error }.
//   * Every route takes an optional ?house=, defaulting to the configured one.

const KIND = "commodities";
const STALE_AFTER_SECONDS = 2 * 60 * 60; // no new snapshot for 2h = stale data
const DAY_SECONDS = 24 * 60 * 60;

export interface ApiOptions {
  db: Db;
  defaultHouseId: number;
  // Current time in Unix seconds. Only tests pass this.
  now?: () => number;
}

// --- Query-string schemas ---------------------------------------------------
// Query values always arrive as strings; z.coerce turns "50" into 50 and
// rejects "abc". Each schema also sets the defaults and limits for a route.

const positiveInt = z.coerce.number().int().positive();
const houseParam = positiveInt.optional();

const SearchQuery = z.object({
  q: z.string().trim().max(100).default(""),
  house: houseParam,
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const ItemQuery = z.object({ house: houseParam });

const HistoryQuery = z.object({
  house: houseParam,
  days: z.coerce.number().int().min(1).max(365).default(7),
});

const StatusQuery = z.object({ house: houseParam });

const DealsQuery = z.object({
  house: houseParam,
  show: z.enum(["deals", "falling"]).default("deals"),
  minProfit: z.coerce.number().int().min(0).optional(), // copper per unit
  maxQty: positiveInt.optional(), // most units you'd buy of one item
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const ItemParams = z.object({ id: positiveInt });

// --- Row shapes coming out of SQLite (snake_case, as stored) -----------------

interface SnapshotRow {
  id: number;
  taken_at: number;
  fetched_at: number;
  listing_count: number;
}

interface PriceRow {
  min_price: number | null;
  median_price: number | null;
  quantity: number | null;
  qty_at_min: number | null;
  listing_count: number | null;
}

interface ItemRow extends PriceRow {
  item_id: number;
  name: string | null;
  quality: string | null;
  status: string;
}

// A request we can't serve as asked. The error handler turns it into JSON.
class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// Checks input against a schema; a mismatch becomes a 400 with zod's message.
function parse<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const problem = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new HttpError(400, `Invalid request - ${problem}`);
  }
  return result.data;
}

// Price columns -> the JSON shape, or null when the item isn't listed right now.
function toPrice(row: PriceRow) {
  if (row.min_price === null) return null;
  return {
    minPrice: row.min_price,
    medianPrice: row.median_price,
    quantity: row.quantity,
    qtyAtMin: row.qty_at_min,
    listingCount: row.listing_count,
  };
}

// In a LIKE pattern, % and _ are wildcards. Escape them so a search for
// "50%" looks for those characters instead of matching everything.
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export function createApp(options: ApiOptions): Express {
  const { db, defaultHouseId } = options;
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));

  // Statements are prepared once here, not on every request.
  const latestSnapshot = db.prepare<[number], SnapshotRow>(`
    SELECT id, taken_at, fetched_at, listing_count
    FROM snapshots
    WHERE house_id = ? AND kind = '${KIND}' AND status = 'ok'
    ORDER BY taken_at DESC
    LIMIT 1
  `);

  // Search runs over every item we've ever seen, joined to its price in the
  // latest snapshot. An item that isn't listed right now still shows up, with
  // price: null - LEFT JOIN keeps the item when there's no matching price row.
  const SEARCH_WHERE = `
    @q = '' OR i.name LIKE @pattern ESCAPE '\\' OR CAST(i.item_id AS TEXT) = @q
  `;
  const searchItems = db.prepare<
    { q: string; pattern: string; snapshotId: number; limit: number; offset: number },
    ItemRow
  >(`
    SELECT i.item_id, i.name, i.quality, i.status,
           p.min_price, p.median_price, p.quantity, p.qty_at_min, p.listing_count
    FROM items i
    LEFT JOIN commodity_prices p ON p.item_id = i.item_id AND p.snapshot_id = @snapshotId
    WHERE ${SEARCH_WHERE}
    ORDER BY i.name IS NULL, i.name COLLATE NOCASE, i.item_id   -- unnamed items last
    LIMIT @limit OFFSET @offset
  `);
  const countItems = db.prepare<{ q: string; pattern: string }, { n: number }>(`
    SELECT COUNT(*) AS n FROM items i WHERE ${SEARCH_WHERE}
  `);

  const oneItem = db.prepare<{ itemId: number; snapshotId: number }, ItemRow>(`
    SELECT i.item_id, i.name, i.quality, i.status,
           p.min_price, p.median_price, p.quantity, p.qty_at_min, p.listing_count
    FROM items i
    LEFT JOIN commodity_prices p ON p.item_id = i.item_id AND p.snapshot_id = @snapshotId
    WHERE i.item_id = @itemId
  `);
  const itemLevels = db.prepare<[number, number], { unitPrice: number; quantity: number }>(`
    SELECT unit_price AS unitPrice, quantity
    FROM price_levels
    WHERE snapshot_id = ? AND item_id = ?
    ORDER BY level
  `);
  const itemExists = db.prepare<[number], { n: number }>("SELECT COUNT(*) AS n FROM items WHERE item_id = ?");

  const itemHistory = db.prepare<
    { itemId: number; houseId: number; since: number },
    { takenAt: number; minPrice: number; medianPrice: number; quantity: number; qtyAtMin: number; listingCount: number }
  >(`
    SELECT s.taken_at AS takenAt, p.min_price AS minPrice, p.median_price AS medianPrice,
           p.quantity, p.qty_at_min AS qtyAtMin, p.listing_count AS listingCount
    FROM commodity_prices p
    JOIN snapshots s ON s.id = p.snapshot_id
    WHERE p.item_id = @itemId AND s.house_id = @houseId AND s.taken_at >= @since
    ORDER BY s.taken_at
  `);

  const snapshotCounts = db.prepare<{ houseId: number; since: number }, { status: string; n: number }>(`
    SELECT status, COUNT(*) AS n
    FROM snapshots
    WHERE house_id = @houseId AND kind = '${KIND}' AND fetched_at >= @since
    GROUP BY status
  `);
  const lastFailure = db.prepare<[number], { fetchedAt: number; error: string }>(`
    SELECT fetched_at AS fetchedAt, error
    FROM snapshots
    WHERE house_id = ? AND kind = '${KIND}' AND status = 'failed'
    ORDER BY fetched_at DESC
    LIMIT 1
  `);
  const itemCounts = db.prepare<[], { status: string; n: number }>(
    "SELECT status, COUNT(*) AS n FROM items GROUP BY status",
  );

  const app = express();
  app.disable("x-powered-by"); // don't advertise what the server runs on

  // GET /api/status?house=
  // Is the data fresh? Drives the "last updated" line and the stale warning.
  app.get("/api/status", (req, res) => {
    const query = parse(StatusQuery, req.query);
    const houseId = query.house ?? defaultHouseId;
    const time = now();

    const latest = latestSnapshot.get(houseId);
    const last24h = Object.fromEntries(
      snapshotCounts.all({ houseId, since: time - DAY_SECONDS }).map((row) => [row.status, row.n]),
    );
    const items = Object.fromEntries(itemCounts.all().map((row) => [row.status, row.n]));

    res.json({
      house: houseId,
      now: time,
      lastSnapshot: latest
        ? {
            takenAt: latest.taken_at,
            fetchedAt: latest.fetched_at,
            listingCount: latest.listing_count,
            ageSeconds: time - latest.taken_at,
          }
        : null,
      // Stale = nothing at all, or the newest snapshot is over 2 hours old.
      stale: !latest || time - latest.taken_at > STALE_AFTER_SECONDS,
      last24h: { ok: last24h.ok ?? 0, empty: last24h.empty ?? 0, failed: last24h.failed ?? 0 },
      lastFailure: lastFailure.get(houseId) ?? null,
      items: { named: items.ok ?? 0, pending: items.pending ?? 0, missing: items.missing ?? 0 },
    });
  });

  // GET /api/items?q=peace&house=&limit=50&offset=0
  // Search by name (or exact item ID), with each item's current price.
  app.get("/api/items", (req, res) => {
    const query = parse(SearchQuery, req.query);
    const houseId = query.house ?? defaultHouseId;
    const latest = latestSnapshot.get(houseId);

    const search = { q: query.q, pattern: likePattern(query.q) };
    const rows = searchItems.all({
      ...search,
      snapshotId: latest?.id ?? -1, // -1 matches no snapshot: every price is null
      limit: query.limit,
      offset: query.offset,
    });

    res.json({
      house: houseId,
      takenAt: latest?.taken_at ?? null,
      total: countItems.get(search)?.n ?? 0, // matches in all, for paging
      limit: query.limit,
      offset: query.offset,
      items: rows.map((row) => ({
        id: row.item_id,
        name: row.name, // null -> the UI shows "Unknown item #id"
        quality: row.quality,
        price: toPrice(row),
      })),
    });
  });

  // GET /api/items/:id?house=
  // One item: its current price and the cheapest price levels (order book).
  app.get("/api/items/:id", (req, res) => {
    const { id: itemId } = parse(ItemParams, req.params);
    const query = parse(ItemQuery, req.query);
    const houseId = query.house ?? defaultHouseId;
    const latest = latestSnapshot.get(houseId);

    const row = oneItem.get({ itemId, snapshotId: latest?.id ?? -1 });
    if (!row) throw new HttpError(404, `Item ${itemId} has never been seen`);

    res.json({
      id: row.item_id,
      name: row.name,
      quality: row.quality,
      nameStatus: row.status, // 'ok', 'pending' (not looked up yet) or 'missing'
      house: houseId,
      takenAt: latest?.taken_at ?? null,
      price: toPrice(row),
      levels: latest ? itemLevels.all(latest.id, itemId) : [],
    });
  });

  // GET /api/items/:id/history?house=&days=7
  // One point per snapshot, oldest first - what the price chart draws.
  app.get("/api/items/:id/history", (req, res) => {
    const { id: itemId } = parse(ItemParams, req.params);
    const query = parse(HistoryQuery, req.query);
    const houseId = query.house ?? defaultHouseId;

    if (!itemExists.get(itemId)?.n) throw new HttpError(404, `Item ${itemId} has never been seen`);

    res.json({
      id: itemId,
      house: houseId,
      days: query.days,
      points: itemHistory.all({ itemId, houseId, since: now() - query.days * DAY_SECONDS }),
    });
  });

  // GET /api/deals?house=&show=deals|falling&minProfit=&maxQty=&limit=100
  // Items priced well below their recent typical price, in a market that
  // isn't simply falling - ranked by total profit after the AH cut.
  // The rule itself is explained in deals.ts.
  app.get("/api/deals", (req, res) => {
    const query = parse(DealsQuery, req.query);
    const houseId = query.house ?? defaultHouseId;
    // Read on every request, so an edit to the settings table applies at once.
    const settings = loadSettings(db);
    const minProfit = query.minProfit ?? settings.dealMinProfit;

    const result = findDeals({
      db,
      houseId,
      settings,
      show: query.show,
      minProfit,
      limit: query.limit,
      ...(query.maxQty === undefined ? {} : { maxQty: query.maxQty }),
    });

    res.json({
      house: houseId,
      show: query.show,
      minProfit,
      takenAt: result.takenAt,
      // Lets the UI say "collecting history: 12 of 48 snapshots" instead of
      // showing an empty list with no explanation.
      history: {
        snapshots: result.snapshotsInWindow,
        needed: settings.dealMinSnapshots,
        ready: result.snapshotsInWindow >= settings.dealMinSnapshots,
        itemsJudged: result.itemsJudged,
      },
      deals: result.deals,
    });
  });

  // GET /api/settings
  // The numbers the deals rule is using right now.
  app.get("/api/settings", (_req, res) => {
    res.json(loadSettings(db));
  });

  // Any other /api path: a JSON 404 rather than Express's HTML page.
  app.use("/api", (_req, _res, next) => next(new HttpError(404, "No such endpoint")));

  // The error handler. Express spots it by its four arguments. Anything a
  // route throws lands here: ours become their status, the rest a plain 500
  // (logged on the server, but with no details leaked to the caller).
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
