import { findCrafts } from "./crafts.js";
import type { Db } from "./db.js";
import { findDeals } from "./deals.js";
import { ALL_PROFESSIONS } from "./professions/index.js";
import { canMake, loadSkills } from "./profile.js";
import { findResets } from "./resets.js";
import type { Settings } from "./settings.js";
import { findVendorDeals } from "./vendor.js";

// Alerts for whole tabs. A rule is "tell me when this tab lists something
// with at least this much profit". After each snapshot every rule is checked
// and new finds are queued for Discord (notify.ts sends them). An item is
// alerted once per tab per day, however long it stays on the list.

export const TAB_KINDS = ["deal", "reset", "vendor", "craft"] as const;
export type TabKind = (typeof TAB_KINDS)[number];

const DAY_SECONDS = 24 * 60 * 60;
// Resets are checked as the tab shows them by default.
const RESET_BUDGET = 500_000;
const RESET_MIN_RISE = 1.5;
// A reset only alerts if what you buy would sell within this many days.
const RESET_MAX_DAYS_OF_STOCK = 3;
// At most this many alerts per tab per snapshot, biggest profit first.
const MAX_PER_CHECK = 5;

export interface TabRule {
  kind: TabKind;
  minProfit: number; // copper
}

export interface TabAlert {
  id: number;
  kind: TabKind;
  itemId: number;
  name: string | null;
  quality: string | null;
  profit: number;
  takenAt: number;
  notifiedAt: number | null;
}

export function listTabRules(db: Db, houseId: number): TabRule[] {
  return db
    .prepare<[number], TabRule>("SELECT kind, min_profit AS minProfit FROM tab_alert_rules WHERE house_id = ?")
    .all(houseId);
}

export function saveTabRule(db: Db, houseId: number, rule: TabRule): void {
  db.prepare(`
    INSERT INTO tab_alert_rules (house_id, kind, min_profit) VALUES (?, ?, ?)
    ON CONFLICT (house_id, kind) DO UPDATE SET min_profit = excluded.min_profit
  `).run(houseId, rule.kind, rule.minProfit);
}

// Returns false if alerts were already off for that tab.
export function deleteTabRule(db: Db, houseId: number, kind: TabKind): boolean {
  return db.prepare("DELETE FROM tab_alert_rules WHERE house_id = ? AND kind = ?").run(houseId, kind).changes > 0;
}

export function listTabAlerts(db: Db, houseId: number, limit = 50): TabAlert[] {
  return db
    .prepare<[number, number], TabAlert>(`
      SELECT a.id, a.kind, a.item_id AS itemId, i.name, i.quality, a.profit,
             a.taken_at AS takenAt, a.notified_at AS notifiedAt
      FROM tab_alerts a
      LEFT JOIN items i ON i.item_id = a.item_id
      WHERE a.house_id = ?
      ORDER BY a.id DESC
      LIMIT ?
    `)
    .all(houseId, limit);
}

interface CheckOptions {
  db: Db;
  houseId: number;
  settings: Settings;
  now?: () => number; // Unix seconds; only tests pass this
}

// What a tab currently lists, as item and profit.
function candidates(kind: TabKind, { db, houseId, settings }: CheckOptions): Array<{ itemId: number; profit: number }> {
  switch (kind) {
    case "deal":
      return findDeals({ db, houseId, settings, show: "deals", minProfit: settings.dealMinProfit, limit: 50 }).deals.map(
        (d) => ({ itemId: d.id, profit: d.totalProfit }),
      );
    case "reset":
      return findResets({
        db,
        houseId,
        ahCut: settings.ahCut,
        maxCost: RESET_BUDGET,
        minRise: RESET_MIN_RISE,
        limit: 50,
      })
        .resets.filter((r) => r.soldPerDay !== null && r.units <= r.soldPerDay * RESET_MAX_DAYS_OF_STOCK)
        .map((r) => ({ itemId: r.id, profit: r.profit }));
    case "vendor":
      return findVendorDeals(db, houseId).deals.map((d) => ({ itemId: d.id, profit: d.profit }));
    case "craft": {
      // Only recipes the saved character can make.
      const skills = loadSkills(db);
      return findCrafts(db, houseId, ALL_PROFESSIONS, settings.ahCut)
        .crafts.filter((c) => canMake(skills, c.profession.id, c.skill))
        .map((c) => ({ itemId: c.productId, profit: c.totalProfit }));
    }
  }
}

// Queues alerts for everything a rule now matches. Returns how many were raised.
export function checkTabAlerts(options: CheckOptions): number {
  const { db, houseId } = options;
  const now = (options.now ?? (() => Math.floor(Date.now() / 1000)))();
  const rules = listTabRules(db, houseId);
  if (rules.length === 0) return 0;

  const takenAt =
    db
      .prepare<[number], { takenAt: number }>(`
        SELECT taken_at AS takenAt FROM snapshots
        WHERE house_id = ? AND kind = 'commodities' AND status = 'ok'
        ORDER BY taken_at DESC LIMIT 1
      `)
      .get(houseId)?.takenAt ?? null;
  if (takenAt === null) return 0;

  const insert = db.prepare(`
    INSERT INTO tab_alerts (house_id, kind, item_id, profit, taken_at, created_at)
    SELECT @houseId, @kind, @itemId, @profit, @takenAt, @now
    WHERE NOT EXISTS (
      SELECT 1 FROM tab_alerts
      WHERE house_id = @houseId AND kind = @kind AND item_id = @itemId AND created_at > @now - ${DAY_SECONDS}
    )
  `);

  let raised = 0;
  for (const rule of rules) {
    const matches = candidates(rule.kind, options)
      .filter((c) => c.profit >= rule.minProfit && c.profit > 0)
      .sort((a, b) => b.profit - a.profit);
    let fromThisRule = 0;
    for (const match of matches) {
      if (fromThisRule >= MAX_PER_CHECK) break;
      const added = insert.run({ houseId, kind: rule.kind, takenAt, now, ...match }).changes;
      fromThisRule += added;
      raised += added;
    }
  }
  return raised;
}
