import type { Db } from "./db.js";
import { findDeals } from "./deals.js";
import { findResets } from "./resets.js";
import type { Settings } from "./settings.js";

// The track record: saves what Deals and Resets recommended after each
// snapshot, then checks the price a day later. "Actual" profit is what you
// would have made buying as recommended and selling every unit at the
// cheapest price 24 hours on, after the AH cut. It is a yardstick, not a
// ledger: nobody knows whether the units would really have sold.

const DAY_SECONDS = 24 * 60 * 60;
// The most picks saved per tab per snapshot.
const TOP = 20;
// Resets are saved as the tab shows them by default.
const RESET_BUDGET = 500_000;
const RESET_MIN_RISE = 1.5;

export type RecommendationKind = "deal" | "reset";

interface RecordOptions {
  db: Db;
  houseId: number;
  settings: Settings;
}

// Saves this snapshot's top picks. An item already saved for the same tab in
// the last day is skipped, so a deal that sits there for hours counts once.
export function recordRecommendations({ db, houseId, settings }: RecordOptions): number {
  const deals = findDeals({ db, houseId, settings, minProfit: settings.dealMinProfit, limit: TOP });
  const takenAt = deals.takenAt;
  if (takenAt === null) return 0;
  const resets = findResets({
    db,
    houseId,
    ahCut: settings.ahCut,
    maxCost: RESET_BUDGET,
    minRise: RESET_MIN_RISE,
    limit: TOP,
  });

  const picks: Array<{ kind: RecommendationKind; itemId: number; units: number; cost: number; expected: number }> = [
    ...deals.deals.map((d) => ({
      kind: "deal" as const,
      itemId: d.id,
      units: d.buyQty,
      cost: d.minPrice * d.buyQty,
      expected: d.totalProfit,
    })),
    ...resets.resets.map((r) => ({
      kind: "reset" as const,
      itemId: r.id,
      units: r.units,
      cost: r.cost,
      expected: r.profit,
    })),
  ];

  const insert = db.prepare(`
    INSERT INTO recommendations (house_id, kind, item_id, taken_at, units, cost, expected_profit)
    SELECT @houseId, @kind, @itemId, @takenAt, @units, @cost, @expected
    WHERE NOT EXISTS (
      SELECT 1 FROM recommendations
      WHERE house_id = @houseId AND kind = @kind AND item_id = @itemId AND taken_at > @takenAt - ${DAY_SECONDS}
    )
  `);
  let saved = 0;
  db.transaction(() => {
    for (const pick of picks) {
      if (pick.units <= 0 || pick.cost <= 0) continue;
      saved += insert.run({ houseId, takenAt, ...pick }).changes;
    }
  })();
  return saved;
}

export interface Outcome {
  id: number;
  kind: RecommendationKind;
  itemId: number;
  name: string | null;
  quality: string | null;
  takenAt: number;
  units: number;
  cost: number;
  expectedProfit: number;
  // "pending" until a snapshot a day later exists; "unlisted" if the item was not on sale then.
  status: "pending" | "unlisted" | "judged";
  laterPrice: number | null; // cheapest price a day later
  actualProfit: number | null;
}

export interface KindSummary {
  kind: RecommendationKind;
  saved: number;
  judged: number;
  profitable: number; // of the judged
  cost: number; // of the judged
  expectedProfit: number; // of the judged
  actualProfit: number; // of the judged
}

export interface TrackRecord {
  since: number | null; // when the first pick was saved
  summary: KindSummary[];
  recent: Outcome[];
}

export function loadTrackRecord(db: Db, houseId: number, ahCut: number, recentLimit = 100): TrackRecord {
  const rows = db
    .prepare<{ houseId: number }, Omit<Outcome, "status" | "actualProfit"> & { laterSnapshot: number | null }>(`
      SELECT r.id, r.kind, r.item_id AS itemId, i.name, i.quality, r.taken_at AS takenAt,
             r.units, r.cost, r.expected_profit AS expectedProfit,
             later.id AS laterSnapshot, p.min_price AS laterPrice
      FROM recommendations r
      LEFT JOIN items i ON i.item_id = r.item_id
      LEFT JOIN snapshots later ON later.id = (
        SELECT id FROM snapshots
        WHERE house_id = r.house_id AND kind = 'commodities' AND status = 'ok'
          AND taken_at >= r.taken_at + ${DAY_SECONDS}
        ORDER BY taken_at
        LIMIT 1
      )
      LEFT JOIN commodity_prices p ON p.snapshot_id = later.id AND p.item_id = r.item_id
      WHERE r.house_id = @houseId
      ORDER BY r.taken_at DESC, r.expected_profit DESC
    `)
    .all({ houseId });

  const outcomes: Outcome[] = rows.map(({ laterSnapshot, ...row }) => {
    const status = laterSnapshot === null ? "pending" : row.laterPrice === null ? "unlisted" : "judged";
    const actualProfit =
      row.laterPrice === null ? null : row.units * Math.floor(row.laterPrice * (1 - ahCut)) - row.cost;
    return { ...row, status, actualProfit };
  });

  const summary = (["deal", "reset"] as const).map((kind): KindSummary => {
    const all = outcomes.filter((o) => o.kind === kind);
    const judged = all.filter((o) => o.status === "judged");
    const sum = (pick: (o: Outcome) => number) => judged.reduce((total, o) => total + pick(o), 0);
    return {
      kind,
      saved: all.length,
      judged: judged.length,
      profitable: judged.filter((o) => (o.actualProfit ?? 0) > 0).length,
      cost: sum((o) => o.cost),
      expectedProfit: sum((o) => o.expectedProfit),
      actualProfit: sum((o) => o.actualProfit ?? 0),
    };
  });

  return {
    since: outcomes.length > 0 ? Math.min(...outcomes.map((o) => o.takenAt)) : null,
    summary,
    recent: outcomes.slice(0, recentLimit),
  };
}
