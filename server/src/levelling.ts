import type { Db } from "./db.js";
import { costToBuy, type Book, type BookLevel } from "./favor.js";

// Works out the cheapest way to level a crafting profession at current prices.
// For each skill point it picks the recipe with the lowest expected cost, then
// groups the result into steps ("craft 25 x Elixir of Wisdom, 95 -> 120").
// Potions made along the way are used as reagents for later steps. Trainer fees
// and the sale value of what you craft are not counted.

export interface Recipe {
  spellId: number;
  name: string;
  learn: number; // skill needed to learn it
  yellow: number; // skill-ups stop being guaranteed here
  grey: number; // no skill-ups from here
  makes: { itemId: number; quantity: number };
  reagents: Array<{ itemId: number; quantity: number }>;
}

export interface Profession {
  id: string;
  name: string;
  recipes: Recipe[];
  vendorPrices: Record<number, number>; // copper; unlimited supply
  itemNames: Record<number, string>;
}

// Chance of a skill point from one craft. Guaranteed below yellow, then falling
// in a straight line to zero at grey. This is the Classic formula; it has not
// been confirmed for Forever.
export function skillUpChance(recipe: Recipe, skill: number): number {
  if (skill < recipe.learn || skill >= recipe.grey) return 0;
  if (skill < recipe.yellow) return 1;
  return (recipe.grey - skill) / (recipe.grey - recipe.yellow);
}

// An item's order book. Units past `exactUnits` are priced by estimate: the
// database keeps only the cheapest levels, not the whole market.
export interface MarketItem {
  book: Book;
  exactUnits: number;
}
export type Market = ReadonlyMap<number, MarketItem>;

export interface StepMaterial {
  itemId: number;
  name: string;
  quantity: number;
  crafted: number; // how many of `quantity` come from earlier steps, not bought
  cost: number;
  vendor: boolean;
  estimated: boolean;
}

export interface LevelStep {
  from: number;
  to: number;
  spellId: number;
  recipeName: string;
  crafts: number; // expected, rounded up
  guaranteed: boolean; // every craft gives a point
  materials: StepMaterial[];
  cost: number;
}

export interface LevelBracket {
  from: number;
  to: number;
  cost: number;
  complete: boolean;
}

export interface LevelPlan {
  from: number;
  to: number;
  reached: number; // below `to` when the market ran out
  complete: boolean;
  totalCost: number;
  brackets: LevelBracket[];
  steps: LevelStep[];
  shopping: StepMaterial[];
}

export const MAX_SKILL = 300;
// Skill tiers: where the totals are split.
const TIER_BREAKS = [150, 225];

// Price of the unit at `position` (0 = cheapest), or null when none is left.
function unitPriceAt(book: Book, position: number): number | null {
  let seen = 0;
  for (const level of book) {
    seen += level.quantity;
    if (position < seen) return level.unitPrice;
  }
  return null;
}

export function planLevelling(profession: Profession, market: Market, from: number, to: number): LevelPlan {
  const vendor = profession.vendorPrices;

  // Pass 1: choose a recipe for each skill point by expected cost, tracking how
  // much of each item has been used so later points see dearer prices.
  const used = new Map<number, number>();
  const made = new Map<number, number>(); // crafted earlier and not yet used
  const choices: Array<{ skill: number; recipe: Recipe; crafts: number }> = [];

  for (let skill = from; skill < to; skill++) {
    let best: { recipe: Recipe; crafts: number; cost: number } | undefined;
    for (const recipe of profession.recipes) {
      const chance = skillUpChance(recipe, skill);
      if (chance === 0) continue;
      const crafts = 1 / chance;

      let cost = 0;
      for (const reagent of recipe.reagents) {
        if ((made.get(reagent.itemId) ?? 0) >= reagent.quantity * crafts) continue; // already have them
        const price =
          vendor[reagent.itemId] ??
          unitPriceAt(market.get(reagent.itemId)?.book ?? [], Math.floor(used.get(reagent.itemId) ?? 0));
        if (price === null) {
          cost = Infinity;
          break;
        }
        cost += price * reagent.quantity * crafts;
      }
      if (cost < (best?.cost ?? Infinity)) best = { recipe, crafts, cost };
    }
    if (!best) break; // nothing can be crafted for this point

    choices.push({ skill, recipe: best.recipe, crafts: best.crafts });
    for (const reagent of best.recipe.reagents) {
      const need = reagent.quantity * best.crafts;
      const fromMade = Math.min(made.get(reagent.itemId) ?? 0, need);
      made.set(reagent.itemId, (made.get(reagent.itemId) ?? 0) - fromMade);
      used.set(reagent.itemId, (used.get(reagent.itemId) ?? 0) + need - fromMade);
    }
    const product = best.recipe.makes;
    made.set(product.itemId, (made.get(product.itemId) ?? 0) + product.quantity * best.crafts);
  }

  // Pass 2: group consecutive points on the same recipe into steps (never
  // across a tier break) and price each step exactly, walking the order books.
  const bought = new Map<number, number>();
  const stock = new Map<number, number>();
  const steps: LevelStep[] = [];
  let index = 0;
  let reached = from;

  while (index < choices.length) {
    const first = choices[index]!;
    let end = index;
    let expected = 0;
    while (
      end < choices.length &&
      choices[end]!.recipe === first.recipe &&
      (end === index || !TIER_BREAKS.includes(choices[end]!.skill))
    ) {
      expected += choices[end]!.crafts;
      end++;
    }
    const crafts = Math.ceil(expected - 1e-9);

    const materials: StepMaterial[] = [];
    let affordable = true;
    for (const reagent of first.recipe.reagents) {
      const quantity = reagent.quantity * crafts;
      const crafted = Math.min(stock.get(reagent.itemId) ?? 0, quantity);
      const toBuy = quantity - crafted;
      const already = bought.get(reagent.itemId) ?? 0;
      const vendorPrice = vendor[reagent.itemId];
      const item = market.get(reagent.itemId);
      const cost =
        toBuy === 0 ? 0 : vendorPrice !== undefined ? vendorPrice * toBuy : costToBuy(item?.book, toBuy, already);
      if (cost === null) {
        affordable = false;
        break;
      }
      materials.push({
        itemId: reagent.itemId,
        name: profession.itemNames[reagent.itemId] ?? `Item #${reagent.itemId}`,
        quantity,
        crafted,
        cost,
        vendor: vendorPrice !== undefined,
        estimated: vendorPrice === undefined && toBuy > 0 && already + toBuy > (item?.exactUnits ?? 0),
      });
    }
    if (!affordable) break; // rounding up needed more than the market holds

    for (const material of materials) {
      stock.set(material.itemId, (stock.get(material.itemId) ?? 0) - material.crafted);
      bought.set(material.itemId, (bought.get(material.itemId) ?? 0) + material.quantity - material.crafted);
    }
    const product = first.recipe.makes;
    stock.set(product.itemId, (stock.get(product.itemId) ?? 0) + product.quantity * crafts);
    const last = choices[end - 1]!;
    steps.push({
      from: first.skill,
      to: last.skill + 1,
      spellId: first.recipe.spellId,
      recipeName: first.recipe.name,
      crafts,
      guaranteed: last.skill < first.recipe.yellow,
      materials,
      cost: materials.reduce((sum, m) => sum + m.cost, 0),
    });
    reached = last.skill + 1;
    index = end;
  }

  // Totals per tier, and one shopping list for the whole plan.
  const edges = [from, ...TIER_BREAKS.filter((skill) => skill > from && skill < to), to];
  const brackets: LevelBracket[] = [];
  for (let i = 0; i + 1 < edges.length; i++) {
    const [start, stop] = [edges[i]!, edges[i + 1]!];
    brackets.push({
      from: start,
      to: stop,
      cost: steps.filter((s) => s.from >= start && s.to <= stop).reduce((sum, s) => sum + s.cost, 0),
      complete: reached >= stop,
    });
  }

  const shopping = new Map<number, StepMaterial>();
  // The shopping list counts only what has to be bought.
  for (const material of steps.flatMap((s) => s.materials)) {
    const toBuy = material.quantity - material.crafted;
    if (toBuy === 0) continue;
    const line = shopping.get(material.itemId);
    if (line) {
      line.quantity += toBuy;
      line.cost += material.cost;
      line.estimated ||= material.estimated;
    } else {
      shopping.set(material.itemId, { ...material, quantity: toBuy, crafted: 0 });
    }
  }

  return {
    from,
    to,
    reached,
    complete: reached >= to,
    totalCost: steps.reduce((sum, s) => sum + s.cost, 0),
    brackets,
    steps,
    shopping: [...shopping.values()].sort((a, b) => b.cost - a.cost),
  };
}

// --- Database side ---

export interface MarketData {
  takenAt: number | null;
  market: Market;
}

// Order books for a profession's reagents, from the latest snapshot.
export function loadMarket(db: Db, houseId: number, profession: Profession): MarketData {
  const snapshot = db
    .prepare<[number], { id: number; takenAt: number }>(`
      SELECT id, taken_at AS takenAt
      FROM snapshots
      WHERE house_id = ? AND kind = 'commodities' AND status = 'ok'
      ORDER BY taken_at DESC
      LIMIT 1
    `)
    .get(houseId);
  if (!snapshot) return { takenAt: null, market: new Map() };

  const ids = [...new Set(profession.recipes.flatMap((recipe) => recipe.reagents.map((r) => r.itemId)))];
  // The IDs are our own integers, so building the IN (...) list is safe.
  const idList = ids.join(",");

  const books = new Map<number, BookLevel[]>();
  const levels = db
    .prepare<[number], { itemId: number; unitPrice: number; quantity: number }>(`
      SELECT item_id AS itemId, unit_price AS unitPrice, quantity
      FROM price_levels
      WHERE snapshot_id = ? AND item_id IN (${idList})
      ORDER BY item_id, level
    `)
    .all(snapshot.id);
  for (const { itemId, unitPrice, quantity } of levels) {
    let book = books.get(itemId);
    if (!book) books.set(itemId, (book = []));
    book.push({ unitPrice, quantity });
  }

  const totals = db
    .prepare<[number], { itemId: number; quantity: number; medianPrice: number }>(`
      SELECT item_id AS itemId, quantity, median_price AS medianPrice
      FROM commodity_prices
      WHERE snapshot_id = ? AND item_id IN (${idList})
    `)
    .all(snapshot.id);

  const market = new Map<number, MarketItem>();
  for (const { itemId, quantity, medianPrice } of totals) {
    const book = books.get(itemId) ?? [];
    const exactUnits = book.reduce((sum, level) => sum + level.quantity, 0);
    // Units listed beyond the stored levels: assume the dearer of the last
    // stored price and the median.
    if (quantity > exactUnits) {
      book.push({ unitPrice: Math.max(book.at(-1)?.unitPrice ?? 0, medianPrice), quantity: quantity - exactUnits });
    }
    market.set(itemId, { book, exactUnits });
  }
  return { takenAt: snapshot.takenAt, market };
}
