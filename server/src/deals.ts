import type { Db } from "./db.js";
import type { Settings } from "./settings.js";

// The trend-aware deals rule from the build plan.
//
// For one item, given its hourly minimum prices over the last 7 days:
//   1. Fewer than `dealMinSnapshots` points -> not enough history, no verdict.
//   2. recent = median of the last 24 hours; week = median of the last 7 days.
//   3. trend = recent / week. Below 0.85 the market is FALLING: never a deal,
//      however cheap it looks, because "cheap" is just where the price is
//      heading. Above 1.15 it is rising.
//   4. Expected sale price = the LOWER of recent and week, minus the AH cut.
//      Taking the lower one stops a one-off spike flattering the deal.
//   5. Profit per unit = expected sale - current min. It's a deal when that
//      reaches the minimum profit AND current min <= 80% of recent.
//   6. Rank by profit per unit x the units available at that price (capped
//      at how many you'd actually buy).
//
// The thresholds are starting guesses and live in the settings table.
//
// The rule itself (evaluateItem) is a pure function: numbers in, verdict out.
// findDeals wraps it with the database queries.

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
  // Cheap enough against the 24-hour median, and not in a falling market.
  // (The minimum-profit test is applied separately, per request.)
  isDeal: boolean;
}

// Middle value of a list of whole numbers. With an even count there are two
// middle values; we average them and round down, to stay in whole copper.
export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error("median of an empty list");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] as number;
  if (sorted.length % 2 === 1) return upper;
  return Math.floor(((sorted[mid - 1] as number) + upper) / 2);
}

// Applies the rule to one item. `weekMins` are its hourly minimum prices over
// the last 7 days and `dayMins` the subset from the last 24 hours.
// Returns null when there isn't enough history to judge.
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

  // Round the sale price down: never promise copper you might not get.
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
  // "deals": items that pass the rule. "falling": items in a falling market,
  // which are never deals - shown separately so you can see what's dropping.
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

  // The 7-day and 24-hour windows end at the latest snapshot, not at "now",
  // so the maths stays the same if the collector was down for a while.
  const weekStart = latest.taken_at - WEEK_SECONDS;
  const dayStart = latest.taken_at - DAY_SECONDS;

  const snapshotsInWindow =
    db
      .prepare<[number, number], { n: number }>(`
        SELECT COUNT(*) AS n FROM snapshots
        WHERE house_id = ? AND kind = 'commodities' AND status = 'ok' AND taken_at > ?
      `)
      .get(houseId, weekStart)?.n ?? 0;

  // Not even one item can have enough history yet: skip the heavy query.
  if (snapshotsInWindow < settings.dealMinSnapshots) {
    return { takenAt: latest.taken_at, snapshotsInWindow, itemsJudged: 0, deals: [] };
  }

  // Every price point of the last week, for every item. That is at most
  // 168 snapshots x ~1,200 items = ~200,000 small rows, which SQLite and
  // JavaScript handle in a fraction of a second. Medians are awkward in SQL,
  // so the grouping and the rule run in JavaScript.
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

  // Only items on sale right now can be bought, so start from the latest snapshot.
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
