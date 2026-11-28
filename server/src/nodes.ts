import { z } from "zod";
import type { Db } from "./db.js";
import { parseSavedVariables, type LuaValue } from "./savedVariables.js";

// Node visits logged in game by the NodeLog addon (addon/NodeLog) and uploaded
// from its SavedVariables file: what each node type drops and what a visit is
// worth at current prices.

const LootSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  qty: z.number().int().positive(),
});

const EntrySchema = z.object({
  id: z.string().min(1).max(200),
  realm: z.string().min(1),
  character: z.string().min(1),
  t: z.number().int().positive(),
  lastT: z.number().int().positive().optional(),
  kind: z.enum(["mining", "herbalism"]),
  node: z.string().min(1),
  objectId: z.number().int().positive().optional(),
  zone: z.string().optional(),
  subzone: z.string().optional(),
  mapId: z.number().int().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  level: z.number().int().optional(),
  skill: z.number().int().optional(),
  taps: z.number().int().positive(),
  // Keyed by item name; an empty Lua table reads as an array.
  items: z.union([z.record(z.string(), LootSchema), z.array(LootSchema)]),
});

export class NodeLogFormatError extends Error {}

export interface NodeImport {
  visits: number; // in the file
  added: number; // not stored before
  skipped: number; // entries that did not have the expected shape
}

const asList = (value: LuaValue | undefined): LuaValue[] =>
  Array.isArray(value) ? value : value && typeof value === "object" ? Object.values(value) : [];

// Re-uploading is safe: a visit already stored is updated (it may have gained taps).
export function importNodeLog(db: Db, text: string): NodeImport {
  let log: LuaValue | undefined;
  try {
    log = parseSavedVariables(text).NodeLogDB;
  } catch {
    throw new NodeLogFormatError("That isn't NodeLog.lua: it could not be read as a WoW SavedVariables file.");
  }
  if (!log || typeof log !== "object" || Array.isArray(log)) {
    throw new NodeLogFormatError(
      "No NodeLogDB in the file. Is it NodeLog.lua from WTF/Account/<account>/SavedVariables?",
    );
  }

  const exists = db.prepare<[string], { n: number }>("SELECT COUNT(*) AS n FROM node_visits WHERE id = ?");
  const upsert = db.prepare(`
    INSERT INTO node_visits (id, realm, character, visited_at, last_tap_at, kind, node, object_id,
                             zone, subzone, map_id, x, y, level, skill, taps)
    VALUES (@id, @realm, @character, @visitedAt, @lastTapAt, @kind, @node, @objectId,
            @zone, @subzone, @mapId, @x, @y, @level, @skill, @taps)
    ON CONFLICT (id) DO UPDATE SET last_tap_at = excluded.last_tap_at, taps = excluded.taps
  `);
  const clearLoot = db.prepare("DELETE FROM node_loot WHERE visit_id = ?");
  const addLoot = db.prepare(
    "INSERT INTO node_loot (visit_id, item_id, item_name, quantity) VALUES (@visitId, @itemId, @itemName, @quantity)",
  );

  const entries = asList(log.entries);
  return db.transaction(() => {
    const result: NodeImport = { visits: entries.length, added: 0, skipped: 0 };
    for (const raw of entries) {
      const parsed = EntrySchema.safeParse(raw);
      if (!parsed.success) {
        result.skipped++;
        continue;
      }
      const e = parsed.data;
      if (!exists.get(e.id)?.n) result.added++;
      upsert.run({
        id: e.id,
        realm: e.realm,
        character: e.character,
        visitedAt: e.t,
        lastTapAt: Math.max(e.lastT ?? e.t, e.t),
        kind: e.kind,
        node: e.node,
        objectId: e.objectId ?? null,
        zone: e.zone || null,
        subzone: e.subzone || null,
        mapId: e.mapId ?? null,
        x: e.x ?? null,
        y: e.y ?? null,
        level: e.level ?? null,
        skill: e.skill ?? null,
        taps: e.taps,
      });
      // The loot is rewritten, because a visit uploaded mid-vein gains taps later.
      clearLoot.run(e.id);
      const byItem = new Map<number, { name: string; qty: number }>();
      for (const loot of Object.values(e.items)) {
        const seen = byItem.get(loot.id);
        byItem.set(loot.id, { name: loot.name, qty: (seen?.qty ?? 0) + loot.qty });
      }
      for (const [itemId, loot] of byItem) {
        addLoot.run({ visitId: e.id, itemId, itemName: loot.name, quantity: loot.qty });
      }
    }
    return result;
  })();
}

export interface NodeItemStat {
  itemId: number;
  name: string;
  quality: string | null;
  seen: boolean; // ever seen on the auction house, so it has an item page
  visitsWith: number; // visits that dropped it at least once
  share: number; // visitsWith / visits
  // 95% range for share (Wilson interval): how far the true rate could be from it.
  shareLow: number;
  shareHigh: number;
  perVisit: number; // average quantity per visit
  unitPrice: number | null; // cheapest listing now; null = not listed
  valuePerVisit: number | null; // perVisit at unitPrice after the AH cut, in copper
}

export interface NodeStat {
  node: string;
  kind: "mining" | "herbalism";
  visits: number;
  taps: number;
  lastVisitAt: number;
  zones: Array<{ zone: string; visits: number }>; // most visits first
  valuePerVisit: number; // sum over priced items
  items: NodeItemStat[];
}

export interface NodeStats {
  takenAt: number | null;
  visits: number;
  lastVisitAt: number | null;
  nodes: NodeStat[];
}

const Z = 1.96;

export function wilson(hits: number, trials: number): { low: number; high: number } {
  if (trials === 0) return { low: 0, high: 1 };
  const p = hits / trials;
  const denominator = 1 + (Z * Z) / trials;
  const centre = (p + (Z * Z) / (2 * trials)) / denominator;
  const half = (Z * Math.sqrt((p * (1 - p)) / trials + (Z * Z) / (4 * trials * trials))) / denominator;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

export function nodeStats(db: Db, houseId: number, ahCut: number): NodeStats {
  const snapshot = db
    .prepare<[number], { id: number; takenAt: number }>(
      `
      SELECT id, taken_at AS takenAt
      FROM snapshots
      WHERE house_id = ? AND kind = 'commodities' AND status = 'ok'
      ORDER BY taken_at DESC
      LIMIT 1
    `,
    )
    .get(houseId);

  const nodes = db
    .prepare<[], { node: string; kind: "mining" | "herbalism"; visits: number; taps: number; lastVisitAt: number }>(
      `
      SELECT node, kind, COUNT(*) AS visits, SUM(taps) AS taps, MAX(visited_at) AS lastVisitAt
      FROM node_visits
      GROUP BY node, kind
      ORDER BY visits DESC, node
    `,
    )
    .all();

  const zones = db
    .prepare<[], { node: string; kind: string; zone: string; visits: number }>(
      `
      SELECT node, kind, COALESCE(zone, 'Unknown') AS zone, COUNT(*) AS visits
      FROM node_visits
      GROUP BY node, kind, zone
      ORDER BY visits DESC, zone
    `,
    )
    .all();

  const loot = db
    .prepare<
      { snapshotId: number },
      {
        node: string;
        kind: string;
        itemId: number;
        visitsWith: number;
        quantity: number;
        name: string;
        quality: string | null;
        seen: number;
        unitPrice: number | null;
      }
    >(
      `
      SELECT v.node, v.kind, l.item_id AS itemId,
             COUNT(*) AS visitsWith, SUM(l.quantity) AS quantity,
             COALESCE(MAX(i.name), MAX(l.item_name)) AS name, MAX(i.quality) AS quality,
             MAX(i.item_id IS NOT NULL) AS seen,
             MAX(COALESCE(p.min_price, r.min_buyout)) AS unitPrice
      FROM node_loot l
      JOIN node_visits v ON v.id = l.visit_id
      LEFT JOIN items i ON i.item_id = l.item_id
      LEFT JOIN commodity_prices p ON p.item_id = l.item_id AND p.snapshot_id = @snapshotId
      LEFT JOIN item_prices r ON r.item_id = l.item_id AND r.snapshot_id = @snapshotId
      GROUP BY v.node, v.kind, l.item_id
    `,
    )
    .all({ snapshotId: snapshot?.id ?? -1 });

  const stats = nodes.map((n): NodeStat => {
    const items = loot
      .filter((row) => row.node === n.node && row.kind === n.kind)
      .map((row): NodeItemStat => {
        const { low, high } = wilson(row.visitsWith, n.visits);
        const afterCut = row.unitPrice === null ? null : Math.floor(row.unitPrice * (1 - ahCut));
        return {
          itemId: row.itemId,
          name: row.name,
          quality: row.quality,
          seen: row.seen === 1,
          visitsWith: row.visitsWith,
          share: row.visitsWith / n.visits,
          shareLow: low,
          shareHigh: high,
          perVisit: row.quantity / n.visits,
          unitPrice: row.unitPrice,
          valuePerVisit: afterCut === null ? null : Math.round((row.quantity * afterCut) / n.visits),
        };
      })
      .sort(
        (a, b) => (b.valuePerVisit ?? -1) - (a.valuePerVisit ?? -1) || b.perVisit - a.perVisit || a.itemId - b.itemId,
      );
    return {
      ...n,
      zones: zones.filter((z) => z.node === n.node && z.kind === n.kind).map(({ zone, visits }) => ({ zone, visits })),
      valuePerVisit: items.reduce((sum, item) => sum + (item.valuePerVisit ?? 0), 0),
      items,
    };
  });

  return {
    takenAt: snapshot?.takenAt ?? null,
    visits: stats.reduce((sum, n) => sum + n.visits, 0),
    lastVisitAt: stats.length ? Math.max(...stats.map((n) => n.lastVisitAt)) : null,
    nodes: stats,
  };
}
