import type { Db } from "./db.js";
import type { Settings } from "./settings.js";

// The trend-aware deals rule, from an item's hourly minimum prices over 7 days:
//   1. Fewer than dealMinSnapshots points: no verdict.
//   2. recent = 24h median, week = 7d median, trend = recent / week.
//   3. A falling trend (< 0.85) is never a deal; > 1.15 is rising.
//   4. Expected sale = the lower of recent and week, minus the AH cut.
//   5. A deal when profit reaches the minimum and current min <= 80% of recent.
//   6. Ranked by profit per unit x units at that price (capped at maxQty).
// Thresholds live in the settings table.

const DAY_SECONDS = 24 * 60 * 60;
const WEEK_SECONDS = 7 * DAY_SECONDS;

export type Trend = "falling" | "stable" | "rising";

export interface ItemEvaluation {
  recentMedian: number; // copper, last 24 hours
  weekMedian: number; // copper, last 7 days
  trendRatio: number; // recent / week, e.g. 0.7
  trend: Trend;
  expectedSale: number; // copper per unit, after the AH cut
  profitPerUnit: number; // copper; can be negative
  // The minimum-profit test is applied separately, per request.
  isDeal: boolean;
}

// An even count averages the two middle values, rounded down.
export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error("median of an empty list");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] as number;
  if (sorted.length % 2 === 1) return upper;
  return Math.floor(((sorted[mid - 1] as number) + upper) / 2);
}

// `dayMins` is the last-24h subset of `weekMins`. null = not enough history.
export function evaluateItem(
  currentMin: number,
  weekMins: readonly number[],
  dayMins: readonly number[],
  settings: Settings,
): ItemEvaluation | null {
  if (weekMins.length < settings.dealMinSnapshots || dayMins.length === 0) return null;

  const recentMedian = median(dayMins);
  const weekMedian = median(weekMins);
  const trendRatio = recentMedian / weekMedian;
  const trend: Trend =
    trendRatio < settings.dealTrendFalling ? "falling" : trendRatio > settings.dealTrendRising ? "rising" : "stable";

  // Rounded down: never promise copper you might not get.
  const expectedSale = Math.floor(Math.min(recentMedian, weekMedian) * (1 - settings.ahCut));
  const profitPerUnit = expectedSale - currentMin;
  const cheapEnough = currentMin <= recentMedian * settings.dealMaxPriceRatio;

  return {
    recentMedian,
    weekMedian,
    trendRatio,
    trend,
    expectedSale,
    profitPerUnit,
    isDeal: trend !== "falling" && cheapEnough,
  };
}

export interface Deal extends ItemEvaluation {
  id: number;
  name: string | null;
  quality: string | null;
  minPrice: number; // current cheapest unit price
  qtyAtMin: number; // units on sale at that price
  snapshots: number; // price points this verdict is based on
  buyQty: number; // qtyAtMin, capped at maxQty
  totalProfit: number; // profitPerUnit x buyQty - what the list is ranked by
}

export interface FindDealsOptions {
  db: Db;
  houseId: number;
  settings: Settings;
  // "falling" lists items in a falling market, which are never deals.
  show: "deals" | "falling";
  minProfit: number; // copper per unit; only applies to show = "deals"
  maxQty?: number; // most units you'd buy of one item
  limit: number;
}

export interface FindDealsResult {
  takenAt: number | null; // the snapshot "current" prices come from
  snapshotsInWindow: number; // snapshots stored in the last 7 days
  itemsJudged: number; // items with enough history for a verdict
  deals: Deal[];
}

export function findDeals(options: FindDealsOptions): FindDealsResult {
  const { db, houseId, settings } = options;

  const latest = db
    .prepare<[number], { id: number; taken_at: number }>(`
      SELECT id, taken_at FROM snapshots
      WHERE house_id = ? AND kind = 'commodities' AND status = 'ok'
      ORDER BY taken_at DESC LIMIT 1
    `)
    .get(houseId);
  if (!latest) return { takenAt: null, snapshotsInWindow: 0, itemsJudged: 0, deals: [] };

  // Windows end at the latest snapshot, not now, so downtime doesn't skew them.
  const weekStart = latest.taken_at - WEEK_SECONDS;
  const dayStart = latest.taken_at - DAY_SECONDS;

  const snapshotsInWindow =
    db
      .prepare<[number, number], { n: number }>(`
        SELECT COUNT(*) AS n FROM snapshots
        WHERE house_id = ? AND kind = 'commodities' AND status = 'ok' AND taken_at > ?
      `)
      .get(houseId, weekStart)?.n ?? 0;

  // Too little history for any item: skip the heavy query.
  if (snapshotsInWindow < settings.dealMinSnapshots) {
    return { takenAt: latest.taken_at, snapshotsInWindow, itemsJudged: 0, deals: [] };
  }

  // Up to ~200,000 rows. Medians are awkward in SQL, so the rule runs in JS.
  const points = db
    .prepare<[number, number], { item_id: number; taken_at: number; min_price: number }>(`
      SELECT p.item_id, s.taken_at, p.min_price
      FROM commodity_prices p
      JOIN snapshots s ON s.id = p.snapshot_id
      WHERE s.house_id = ? AND s.kind = 'commodities' AND s.status = 'ok' AND s.taken_at > ?
    `)
    .all(houseId, weekStart);

  const history = new Map<number, { week: number[]; day: number[] }>();
  for (const point of points) {
    let entry = history.get(point.item_id);
    if (!entry) {
      entry = { week: [], day: [] };
      history.set(point.item_id, entry);
    }
    entry.week.push(point.min_price);
    if (point.taken_at > dayStart) entry.day.push(point.min_price);
  }

  // Only items on sale now can be bought.
  const current = db
    .prepare<
      [number],
      { item_id: number; name: string | null; quality: string | null; min_price: number; qty_at_min: number }
    >(`
      SELECT p.item_id, i.name, i.quality, p.min_price, p.qty_at_min
      FROM commodity_prices p
      LEFT JOIN items i ON i.item_id = p.item_id
      WHERE p.snapshot_id = ?
    `)
    .all(latest.id);

  const deals: Deal[] = [];
  let itemsJudged = 0;
  for (const row of current) {
    const past = history.get(row.item_id);
    if (!past) continue;
    const evaluation = evaluateItem(row.min_price, past.week, past.day, settings);
    if (!evaluation) continue;
    itemsJudged++;

    const wanted =
      options.show === "falling"
        ? evaluation.trend === "falling"
        : evaluation.isDeal && evaluation.profitPerUnit >= options.minProfit;
    if (!wanted) continue;

    const buyQty = Math.min(row.qty_at_min, options.maxQty ?? Infinity);
    deals.push({
      id: row.item_id,
      name: row.name,
      quality: row.quality,
      minPrice: row.min_price,
      qtyAtMin: row.qty_at_min,
      snapshots: past.week.length,
      buyQty,
      totalProfit: evaluation.profitPerUnit * buyQty,
      ...evaluation,
    });
  }

  if (options.show === "falling") {
    deals.sort((a, b) => a.trendRatio - b.trendRatio || a.id - b.id); // steepest fall first
  } else {
    deals.sort((a, b) => b.totalProfit - a.totalProfit || a.id - b.id); // biggest profit first
  }

  return { takenAt: latest.taken_at, snapshotsInWindow, itemsJudged, deals: deals.slice(0, options.limit) };
}
