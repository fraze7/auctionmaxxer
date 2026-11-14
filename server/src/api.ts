import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { Db } from "./db.js";
import { evaluateItem, findDeals } from "./deals.js";
import { loadFavorData, planFavor, priceCrates } from "./favor.js";
import { loadMarket, MAX_SKILL, planLevelling, withHelper, type Profession } from "./levelling.js";
import { ALCHEMY } from "./professions/alchemy.js";
import { BLACKSMITHING } from "./professions/blacksmithing.js";
import { ENCHANTING } from "./professions/enchanting.js";
import { ENGINEERING } from "./professions/engineering.js";
import { LEATHERWORKING } from "./professions/leatherworking.js";
import { TAILORING } from "./professions/tailoring.js";
import { loadSettings } from "./settings.js";
import { deleteWatch, listAlerts, listWatches, saveWatch } from "./watchlist.js";

// The HTTP API the web app reads from. It only reads our own database.
// JSON is camelCase; prices are integer copper; times are Unix seconds.
// Bad input -> 400, unknown thing -> 404, both with { error }.

const KIND = "commodities";
const STALE_AFTER_SECONDS = 2 * 60 * 60; // no new snapshot for 2h = stale data
const DAY_SECONDS = 24 * 60 * 60;

export interface ApiOptions {
  db: Db;
  defaultHouseId: number;
  // Unix seconds. Only tests pass this.
  now?: () => number;
  // The built web app (web/dist), served alongside /api when given.
  webDir?: string;
  discordConfigured?: boolean;
}

// --- Query-string schemas (values arrive as strings, hence z.coerce) ---

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

const FavorQuery = z.object({
  house: houseParam,
  // Recipes cost 30, 60 or 90 favor.
  target: z.coerce.number().int().min(1).max(5000).default(90),
});

const ItemParams = z.object({ id: positiveInt });

const PROFESSIONS = { alchemy: ALCHEMY, blacksmithing: BLACKSMITHING, tailoring: TAILORING, leatherworking: LEATHERWORKING, engineering: ENGINEERING, enchanting: ENCHANTING } satisfies Record<string, Profession>;

const LevellingQuery = z
  .object({
    house: houseParam,
    profession: z.enum(["alchemy", "blacksmithing", "tailoring", "leatherworking", "engineering", "enchanting"]).default("alchemy"),
    from: z.coerce.number().int().min(1).max(MAX_SKILL - 1).default(1),
    to: z.coerce.number().int().min(2).max(MAX_SKILL).default(MAX_SKILL),
    helperSkill: z.coerce.number().int().min(0).max(MAX_SKILL).default(0),
  })
  .refine((query) => query.from < query.to, { path: ["to"], message: "must be above from" });

const WatchlistQuery = z.object({ house: houseParam });

// A JSON body, so numbers must already be numbers (no z.coerce).
const WatchBody = z.object({
  itemId: z.number().int().positive(),
  direction: z.enum(["below", "above"]),
  threshold: z.number().int().min(1).max(10_000_000_000), // copper; up to 1,000,000g
  house: z.number().int().positive().optional(),
});

// --- Row shapes from SQLite (snake_case, as stored) ---

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

// Turned into a JSON error by the error handler.
class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// A schema mismatch becomes a 400.
function parse<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const problem = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new HttpError(400, `Invalid request - ${problem}`);
  }
  return result.data;
}

// null when the item isn't listed right now.
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

// Escape LIKE's wildcards (% and _) so they match literally.
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export function createApp(options: ApiOptions): Express {
  const { db, defaultHouseId } = options;
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));

  const latestSnapshot = db.prepare<[number], SnapshotRow>(`
    SELECT id, taken_at, fetched_at, listing_count
    FROM snapshots
    WHERE house_id = ? AND kind = '${KIND}' AND status = 'ok'
    ORDER BY taken_at DESC
    LIMIT 1
  `);

  // LEFT JOIN: items not listed right now still appear, with price: null.
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

  // Hourly minimum prices, for the trend verdict.
  const itemMins = db.prepare<
    { itemId: number; houseId: number; since: number },
    { takenAt: number; minPrice: number }
  >(`
    SELECT s.taken_at AS takenAt, p.min_price AS minPrice
    FROM commodity_prices p
    JOIN snapshots s ON s.id = p.snapshot_id
    WHERE p.item_id = @itemId AND s.house_id = @houseId AND s.status = 'ok' AND s.taken_at > @since
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

  // GET /api/status?house=  - is the data fresh?
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
      stale: !latest || time - latest.taken_at > STALE_AFTER_SECONDS,
      last24h: { ok: last24h.ok ?? 0, empty: last24h.empty ?? 0, failed: last24h.failed ?? 0 },
      lastFailure: lastFailure.get(houseId) ?? null,
      items: { named: items.ok ?? 0, pending: items.pending ?? 0, missing: items.missing ?? 0 },
    });
  });

  // GET /api/items?q=&house=&limit=&offset=  - search by name or exact ID
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

  // GET /api/items/:id?house=  - current price, trend and order book
  app.get("/api/items/:id", (req, res) => {
    const { id: itemId } = parse(ItemParams, req.params);
    const query = parse(ItemQuery, req.query);
    const houseId = query.house ?? defaultHouseId;
    const latest = latestSnapshot.get(houseId);

    const row = oneItem.get({ itemId, snapshotId: latest?.id ?? -1 });
    if (!row) throw new HttpError(404, `Item ${itemId} has never been seen`);

    // null with too little history, or when not on sale.
    let trend = null;
    if (latest && row.min_price !== null) {
      const week = itemMins.all({ itemId, houseId, since: latest.taken_at - 7 * DAY_SECONDS });
      const dayStart = latest.taken_at - DAY_SECONDS;
      const evaluation = evaluateItem(
        row.min_price,
        week.map((p) => p.minPrice),
        week.filter((p) => p.takenAt > dayStart).map((p) => p.minPrice),
        loadSettings(db),
      );
      trend = evaluation && { ...evaluation, snapshots: week.length };
    }

    res.json({
      id: row.item_id,
      name: row.name,
      quality: row.quality,
      nameStatus: row.status, // 'ok', 'pending' (not looked up yet) or 'missing'
      house: houseId,
      takenAt: latest?.taken_at ?? null,
      price: toPrice(row),
      trend,
      levels: latest ? itemLevels.all(latest.id, itemId) : [],
    });
  });

  // GET /api/items/:id/history?house=&days=  - one point per snapshot, oldest first
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

  // GET /api/deals?house=&show=&minProfit=&maxQty=&limit=  - see deals.ts
  app.get("/api/deals", (req, res) => {
    const query = parse(DealsQuery, req.query);
    const houseId = query.house ?? defaultHouseId;
    // Read per request, so a settings change applies at once.
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
      // Lets the UI explain an empty list while history is still building.
      history: {
        snapshots: result.snapshotsInWindow,
        needed: settings.dealMinSnapshots,
        ready: result.snapshotsInWindow >= settings.dealMinSnapshots,
        itemsJudged: result.itemsJudged,
      },
      deals: result.deals,
    });
  });

  // GET /api/favor?house=&target=  - see favor.ts
  app.get("/api/favor", (req, res) => {
    const query = parse(FavorQuery, req.query);
    const houseId = query.house ?? defaultHouseId;
    const data = loadFavorData(db, houseId);

    // Cheapest per favor first; unfillable crates last.
    const crates = priceCrates(data.crates, data.books).sort((a, b) => {
      if (!a.best || !b.best) return (a.best ? 0 : 1) - (b.best ? 0 : 1) || a.itemId - b.itemId;
      return a.best.copperPerFavor - b.best.copperPerFavor || a.itemId - b.itemId;
    });

    res.json({
      house: houseId,
      takenAt: data.takenAt,
      crates,
      plan: planFavor(data.crates, data.books, query.target),
    });
  });

  // GET /api/levelling?profession=&from=&to=&helperSkill=&house=  - see levelling.ts
  app.get("/api/levelling", (req, res) => {
    const query = parse(LevellingQuery, req.query);
    const houseId = query.house ?? defaultHouseId;
    const base: Profession = PROFESSIONS[query.profession];
    const profession = withHelper(base, query.helperSkill);
    const { takenAt, market } = loadMarket(db, houseId, profession);

    res.json({
      house: houseId,
      takenAt,
      profession: { id: profession.id, name: profession.name },
      helper: base.helper ? { id: base.helper.id, name: base.helper.name, skill: query.helperSkill } : null,
      professions: Object.values(PROFESSIONS).map((p) => ({ id: p.id, name: p.name })),
      ...planLevelling(profession, market, query.from, query.to),
    });
  });

  // --- Watchlist ---
  // Requiring a JSON content type blocks cross-site requests (CSRF): browsers
  // won't send it, or a DELETE, across sites without CORS permission.
  const jsonBody = express.json({ limit: "10kb" });
  const requireJson = (req: Request, _res: Response, next: NextFunction) => {
    if (!req.is("application/json")) return next(new HttpError(415, "Send the request body as JSON"));
    next();
  };

  // GET /api/watchlist?house=  - rules, current prices and past alerts
  app.get("/api/watchlist", (req, res) => {
    const query = parse(WatchlistQuery, req.query);
    const houseId = query.house ?? defaultHouseId;
    res.json({
      house: houseId,
      takenAt: latestSnapshot.get(houseId)?.taken_at ?? null,
      discordConfigured: options.discordConfigured ?? false,
      watches: listWatches(db, houseId),
      alerts: listAlerts(db, houseId),
    });
  });

  // POST /api/watchlist { itemId, direction, threshold }  - add or update a rule
  app.post("/api/watchlist", requireJson, jsonBody, (req, res) => {
    const body = parse(WatchBody, req.body);
    const watch = saveWatch({
      db,
      houseId: body.house ?? defaultHouseId,
      itemId: body.itemId,
      direction: body.direction,
      threshold: body.threshold,
      now,
    });
    if (!watch) throw new HttpError(404, `Item ${body.itemId} has never been seen`);
    res.status(201).json(watch);
  });

  // DELETE /api/watchlist/:id  - past alerts are kept
  app.delete("/api/watchlist/:id", (req, res) => {
    const { id } = parse(ItemParams, req.params);
    if (!deleteWatch(db, id)) throw new HttpError(404, `No watchlist rule ${id}`);
    res.status(204).end(); // 204 = done, nothing to send back
  });

  // GET /api/settings  - the deals rule's current numbers
  app.get("/api/settings", (_req, res) => {
    res.json(loadSettings(db));
  });

  // Unknown /api paths get a JSON 404, not Express's HTML page.
  app.use("/api", (_req, _res, next) => next(new HttpError(404, "No such endpoint")));

  // Static files, then index.html for every other path (the React app routes them).
  const { webDir } = options;
  if (webDir) {
    app.use(express.static(webDir));
    app.use((req, res, next) => {
      if (req.method !== "GET") return next();
      res.sendFile("index.html", { root: webDir });
    });
  }

  // Error handler: HttpErrors keep their status; anything else is a logged 500.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    // express.json() errors (bad or oversized body) carry their own 4xx status.
    const status = (err as { status?: unknown } | null)?.status;
    if (typeof status === "number" && status >= 400 && status < 500) {
      res.status(status).json({ error: "The request body could not be read" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
