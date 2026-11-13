import { CRATES, favorFor, type Crate, type CrateTier } from "./crates.js";
import type { Db } from "./db.js";

// Finds the cheapest way to turn gold into Merchant's Favor.
// A "fill" is one Waylaid Crate plus one bundle of materials. Prices rise as
// you buy, so everything is priced by walking the order book and the planner
// re-prices after each purchase.

export interface BookLevel {
  unitPrice: number;
  quantity: number;
}

// Cheapest first. Only the cheapest levels are stored, so a book can run out early.
export type Book = readonly BookLevel[];

// An item with no entry isn't on sale.
export type Books = ReadonlyMap<number, Book>;

// Cost of `quantity` units after skipping `alreadyBought`; null if too few are listed.
export function costToBuy(book: Book | undefined, quantity: number, alreadyBought = 0): number | null {
  if (!book) return null;
  let toSkip = alreadyBought;
  let toBuy = quantity;
  let cost = 0;
  for (const level of book) {
    let available = level.quantity;
    if (toSkip > 0) {
      const skipped = Math.min(toSkip, available);
      toSkip -= skipped;
      available -= skipped;
    }
    if (available === 0) continue;
    const taken = Math.min(toBuy, available);
    cost += taken * level.unitPrice;
    toBuy -= taken;
    if (toBuy === 0) return cost;
  }
  return null;
}

// itemId is null when no item of that name has been seen.
export interface ResolvedBundle {
  itemId: number | null;
  itemName: string;
  quantity: number;
}

export interface ResolvedCrate {
  itemId: number;
  name: string;
  tier: CrateTier;
  crafted: boolean;
  favor: number;
  favorEstimated: boolean;
  bundles: ResolvedBundle[];
}

// The cheapest single fill of a crate, given what has been bought so far.
interface FillQuote {
  bundleIndex: number;
  crateCost: number;
  materialsCost: number;
  totalCost: number;
}

function quoteFill(crate: ResolvedCrate, books: Books, bought: ReadonlyMap<number, number>): FillQuote | null {
  const crateCost = costToBuy(books.get(crate.itemId), 1, bought.get(crate.itemId) ?? 0);
  if (crateCost === null) return null; // no crate on sale: nothing to fill

  let best: FillQuote | null = null;
  crate.bundles.forEach((bundle, bundleIndex) => {
    if (bundle.itemId === null) return;
    const materialsCost = costToBuy(books.get(bundle.itemId), bundle.quantity, bought.get(bundle.itemId) ?? 0);
    if (materialsCost === null) return;
    const totalCost = crateCost + materialsCost;
    if (!best || totalCost < best.totalCost) {
      best = { bundleIndex, crateCost, materialsCost, totalCost };
    }
  });
  return best;
}

// --- The crate table ---

export interface PricedBundle extends ResolvedBundle {
  cost: number | null; // copper for the whole bundle; null = can't buy that many
  listed: number; // units in the stored order book
}

export interface PricedCrate extends Omit<ResolvedCrate, "bundles"> {
  cratePrice: number | null; // cheapest crate on sale
  cratesListed: number;
  bundles: PricedBundle[];
  // null when the crate or all its bundles are unavailable.
  best: (FillQuote & { copperPerFavor: number }) | null;
}

export function priceCrates(crates: readonly ResolvedCrate[], books: Books): PricedCrate[] {
  const nothingBought = new Map<number, number>();
  const listed = (itemId: number | null) =>
    itemId === null ? 0 : (books.get(itemId) ?? []).reduce((sum, level) => sum + level.quantity, 0);

  return crates.map((crate) => {
    const quote = quoteFill(crate, books, nothingBought);
    return {
      ...crate,
      cratePrice: costToBuy(books.get(crate.itemId), 1),
      cratesListed: listed(crate.itemId),
      bundles: crate.bundles.map((bundle) => ({
        ...bundle,
        cost: bundle.itemId === null ? null : costToBuy(books.get(bundle.itemId), bundle.quantity),
        listed: listed(bundle.itemId),
      })),
      best: quote && { ...quote, copperPerFavor: quote.totalCost / crate.favor },
    };
  });
}

// --- The plan ---

export interface PlanStep {
  crateId: number;
  crateName: string;
  favorEach: number;
  favorEstimated: boolean;
  bundleItemId: number;
  bundleItemName: string;
  bundleQuantity: number; // per crate
  count: number; // how many of this crate to fill this way
  crateCost: number; // copper for all `count` crates
  materialsCost: number; // copper for all the materials
}

export interface FavorPlan {
  target: number;
  favor: number; // favor the plan earns (can overshoot the target)
  totalCost: number;
  // False when the market ran out before the target.
  complete: boolean;
  steps: PlanStep[];
}

// A safety stop, far above any sensible target.
const MAX_FILLS = 2000;

// Greedy: repeatedly take the cheapest fill per favor, mark it bought, re-price.
// Not perfectly optimal (the last fill can overshoot) but close.
export function planFavor(crates: readonly ResolvedCrate[], books: Books, target: number): FavorPlan {
  const bought = new Map<number, number>();
  const steps = new Map<string, PlanStep>();
  let favor = 0;
  let totalCost = 0;

  for (let fills = 0; favor < target && fills < MAX_FILLS; fills++) {
    let pick: { crate: ResolvedCrate; quote: FillQuote } | null = null;
    for (const crate of crates) {
      const quote = quoteFill(crate, books, bought);
      if (!quote) continue;
      // Cross-multiply to compare cost per favor in whole numbers.
      if (!pick || quote.totalCost * pick.crate.favor < pick.quote.totalCost * crate.favor) {
        pick = { crate, quote };
      }
    }
    if (!pick) break; // nothing left to buy anywhere

    const { crate, quote } = pick;
    const bundle = crate.bundles[quote.bundleIndex];
    if (!bundle || bundle.itemId === null) break; // can't happen: quoteFill only returns priced bundles

    bought.set(crate.itemId, (bought.get(crate.itemId) ?? 0) + 1);
    bought.set(bundle.itemId, (bought.get(bundle.itemId) ?? 0) + bundle.quantity);
    favor += crate.favor;
    totalCost += quote.totalCost;

    // Repeat fills of the same crate and bundle share one line.
    const key = `${crate.itemId}:${bundle.itemId}`;
    const step = steps.get(key);
    if (step) {
      step.count++;
      step.crateCost += quote.crateCost;
      step.materialsCost += quote.materialsCost;
    } else {
      steps.set(key, {
        crateId: crate.itemId,
        crateName: crate.name,
        favorEach: crate.favor,
        favorEstimated: crate.favorEstimated,
        bundleItemId: bundle.itemId,
        bundleItemName: bundle.itemName,
        bundleQuantity: bundle.quantity,
        count: 1,
        crateCost: quote.crateCost,
        materialsCost: quote.materialsCost,
      });
    }
  }

  return { target, favor, totalCost, complete: favor >= target, steps: [...steps.values()] };
}

// --- Database side ---

export interface FavorData {
  takenAt: number | null;
  crates: ResolvedCrate[];
  books: Map<number, BookLevel[]>;
}

// Resolves bundle names to item IDs and loads their order books.
export function loadFavorData(db: Db, houseId: number, crateList: readonly Crate[] = CRATES): FavorData {
  const latest = db
    .prepare<[number], { id: number; taken_at: number }>(`
      SELECT id, taken_at FROM snapshots
      WHERE house_id = ? AND kind = 'commodities' AND status = 'ok'
      ORDER BY taken_at DESC LIMIT 1
    `)
    .get(houseId);

  // If two items share a name, prefer the one on sale, then the lower ID.
  const findItem = db.prepare<{ name: string; snapshotId: number }, { item_id: number }>(`
    SELECT i.item_id
    FROM items i
    LEFT JOIN commodity_prices p ON p.item_id = i.item_id AND p.snapshot_id = @snapshotId
    WHERE i.name = @name
    ORDER BY p.item_id IS NULL, i.item_id
    LIMIT 1
  `);
  const snapshotId = latest?.id ?? -1;

  const crates: ResolvedCrate[] = crateList.map((crate) => {
    const { favor, estimated } = favorFor(crate);
    return {
      itemId: crate.itemId,
      name: crate.name,
      tier: crate.tier,
      crafted: crate.crafted,
      favor,
      favorEstimated: estimated,
      bundles: crate.bundles.map((bundle) => ({
        itemId: findItem.get({ name: bundle.itemName, snapshotId })?.item_id ?? null,
        itemName: bundle.itemName,
        quantity: bundle.quantity,
      })),
    };
  });

  const books = new Map<number, BookLevel[]>();
  if (latest) {
    const wanted = new Set<number>();
    for (const crate of crates) {
      wanted.add(crate.itemId);
      for (const bundle of crate.bundles) if (bundle.itemId !== null) wanted.add(bundle.itemId);
    }
    // The IDs are our own integers, so building the IN (...) list is safe.
    const rows = db
      .prepare<[number], { item_id: number; unitPrice: number; quantity: number }>(`
        SELECT item_id, unit_price AS unitPrice, quantity
        FROM price_levels
        WHERE snapshot_id = ? AND item_id IN (${[...wanted].join(",")})
        ORDER BY item_id, level
      `)
      .all(latest.id);
    for (const row of rows) {
      let book = books.get(row.item_id);
      if (!book) {
        book = [];
        books.set(row.item_id, book);
      }
      book.push({ unitPrice: row.unitPrice, quantity: row.quantity });
    }
  }

  return { takenAt: latest?.taken_at ?? null, crates, books };
}
