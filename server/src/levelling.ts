import type { Db } from "./db.js";
import { costToBuy, type Book, type BookLevel } from "./favor.js";

// Works out the cheapest way to level a crafting profession at current prices.
// For each skill point it picks the recipe with the lowest expected cost, then
// groups the result into steps ("craft 25 x Elixir of Wisdom, 95 -> 120").
// Items made along the way are used as reagents for later steps, and a reagent
// the profession can craft (a grinding stone) is priced from its own inputs
// when that is cheaper than buying it. Trainer fees and the sale value of what
// you craft are not counted. With a helper profession (Mining), bars can be
// smelted from ore the same way.

export interface Recipe {
  spellId: number;
  name: string;
  learn: number; // skill needed to learn it
  yellow: number; // skill-ups stop being guaranteed here
  grey: number; // no skill-ups from here
  makes: { itemId: number; quantity: number };
  reagents: Array<{ itemId: number; quantity: number }>;
  plan?: boolean; // taught by a bought plan, not a trainer
}

export interface Profession {
  id: string;
  name: string;
  recipes: Recipe[];
  vendorPrices: Record<number, number>; // copper; unlimited supply
  itemNames: Record<number, string>;
  helper?: Helper; // a second profession that can make some of the reagents
  reagentRecipes?: Recipe[]; // set by withHelper: usable for reagents at any skill
}

// A gathering profession whose recipes make reagents, such as Mining's smelting.
export interface Helper {
  id: string;
  name: string;
  recipes: Recipe[]; // `learn` is the helper's own skill
  vendorPrices: Record<number, number>;
  itemNames: Record<number, string>;
}

// The profession as levelled by a character with `skill` in its helper.
export function withHelper(profession: Profession, skill: number): Profession {
  const helper = profession.helper;
  if (!helper || skill <= 0) return profession;
  return {
    ...profession,
    reagentRecipes: helper.recipes.filter((recipe) => recipe.learn <= skill),
    vendorPrices: { ...helper.vendorPrices, ...profession.vendorPrices },
    itemNames: { ...helper.itemNames, ...profession.itemNames },
  };
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
  // Bought to craft this reagent first. `saves` is against buying the reagent
  // itself; null when too little of it is on sale.
  via?: { name: string; quantity: number; saves: number | null };
}

export interface LevelStep {
  from: number;
  to: number;
  spellId: number;
  recipeName: string;
  crafts: number; // expected, rounded up
  guaranteed: boolean; // every craft gives a point
  plan: boolean;
  materials: StepMaterial[];
  cost: number;
  sells: number; // what a vendor pays for what the step makes; 0 when a later recipe uses it
  stops: Array<{ skill: number; cost: number }>; // the step's cost if it ended early at `skill`
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
  tooDear: boolean; // stopped because the next point cost too much, not for lack of materials
  totalCost: number;
  totalSells: number; // sold to a vendor; totalCost - totalSells is what the route really costs
  brackets: LevelBracket[];
  steps: LevelStep[];
  shopping: StepMaterial[];
}

export const MAX_SKILL = 300;
// Skill tiers: where the totals are split.
const TIER_BREAKS = [150, 225];
// The route stops when a point would cost this many times the dearest so far:
// that only happens when the sensible recipes cannot be supplied.
const PRICE_JUMP = 10;
// Early stopping points are priced at multiples of this within a step.
const STOP_EVERY = 5;

type Choice = { skill: number; recipe: Recipe; crafts: number };

// "Bolt, cloak, bolt, cloak" becomes all the bolts, then all the cloaks, with
// the crafts worked out again for the new order. Skipped if that order would
// take noticeably more crafts.
function groupAlternating(choices: Choice[]): void {
  let i = 0;
  while (i + 1 < choices.length) {
    const a = choices[i]!.recipe;
    const b = choices[i + 1]!.recipe;
    const uses = (user: Recipe, maker: Recipe) => user.reagents.some((r) => r.itemId === maker.makes.itemId);
    const [maker, user] = a === b ? [] : uses(b, a) ? [a, b] : uses(a, b) ? [b, a] : [];
    let j = i;
    while (j < choices.length && (choices[j]!.recipe === a || choices[j]!.recipe === b)) j++;
    if (!maker || !user || j - i < 4) {
      i++;
      continue;
    }
    const run = choices.slice(i, j);
    const start = run[0]!.skill;
    const made = run.filter((choice) => choice.recipe === maker).length;
    const regrouped = run.map((_, k): Choice => {
      const recipe = k < made ? maker : user;
      return { skill: start + k, recipe, crafts: 1 / skillUpChance(recipe, start + k) };
    });
    const total = (list: Choice[]) => list.reduce((sum, choice) => sum + choice.crafts, 0);
    if (total(regrouped) <= total(run) * 1.1) choices.splice(i, j - i, ...regrouped);
    i = j;
  }
}

// A step this short is folded into a neighbouring step when that costs at most
// ABSORB_EXTRA more for those points: fewer rows to follow for a few copper.
const SHORT_STEP = 5;
const ABSORB_EXTRA = 0.25;

// `costs` holds pass 1's price for every usable recipe at each skill.
function absorbShortSteps(choices: Choice[], costs: ReadonlyMap<number, ReadonlyMap<Recipe, number>>): void {
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0, j = 0; i < choices.length; i = j) {
      const own = choices[i]!.recipe;
      while (j < choices.length && choices[j]!.recipe === own) j++;
      const run = choices.slice(i, j);
      if (run.length > SHORT_STEP) continue;
      // Later steps may be counting on what this one makes.
      const feedsLater = choices.slice(j).some((c) => c.recipe.reagents.some((r) => r.itemId === own.makes.itemId));
      if (feedsLater) continue;

      const costOf = (recipe: Recipe) =>
        run.reduce((sum, choice) => sum + (costs.get(choice.skill)?.get(recipe) ?? Infinity), 0);
      const neighbours = [choices[i - 1]?.recipe, choices[j]?.recipe].filter((r): r is Recipe => r !== undefined);
      const best = neighbours.sort((a, b) => costOf(a) - costOf(b))[0];
      if (!best || !Number.isFinite(costOf(best)) || costOf(best) > costOf(own) * (1 + ABSORB_EXTRA)) continue;
      for (const choice of run) {
        choice.recipe = best;
        choice.crafts = 1 / skillUpChance(best, choice.skill);
      }
      changed = true;
    }
  }
}

// `sellPrices`: what a vendor pays for each product. Recipes are chosen by cost
// less that, since a vendor always buys; auction prices are not counted, as
// nothing says the market would take it all. At most SALE_CREDIT of the cost is
// taken off, so a craft is never free and a long green grind of break-even
// crafts does not win.
const SALE_CREDIT = 0.8;
export function planLevelling(
  profession: Profession,
  market: Market,
  from: number,
  to: number,
  sellPrices: ReadonlyMap<number, number> = new Map(),
): LevelPlan {
  const vendor = profession.vendorPrices;
  // Products other recipes use (leather, bolts, oils) are kept, not sold.
  const reagentIds = new Set(profession.recipes.flatMap((recipe) => recipe.reagents.map((r) => r.itemId)));
  const sellValue = (recipe: Recipe, crafts: number) =>
    reagentIds.has(recipe.makes.itemId) ? 0 : (sellPrices.get(recipe.makes.itemId) ?? 0) * recipe.makes.quantity * crafts;

  const helped = profession.reagentRecipes ?? [];
  const makers = new Map([...profession.recipes, ...helped].map((recipe) => [recipe.makes.itemId, recipe]));
  const canMake = (maker: Recipe, skill: number) => helped.includes(maker) || skill >= maker.learn;
  const nameOf = (itemId: number) => profession.itemNames[itemId] ?? `Item #${itemId}`;

  const bought = new Map<number, number>();
  const stock = new Map<number, number>(); // crafted earlier and not yet used
  const steps: LevelStep[] = [];
  let reached = from;
  let tooDear = false;
  const banned = new Set<string>(); // "spell@skill" choices the market could not supply

  // When pass 2 cannot buy a step in full, plan again from where it got to.
  for (let replan = true; replan;) {
    replan = false;
    tooDear = false;
    let dearest = Math.max(0, ...steps.map((step) => step.cost / (step.to - step.from)));

    // Pass 1: choose a recipe for each skill point by expected cost, tracking how
    // much of each item has been used so later points see dearer prices.
    const used = new Map(bought);
    const made = new Map(stock);
    const choices: Choice[] = [];
    const costs = new Map<number, Map<Recipe, number>>();

    const priceOf = (itemId: number, quantity: number) => {
      const vendorPrice = vendor[itemId];
      if (vendorPrice !== undefined) return vendorPrice * quantity;
      return costToBuy(market.get(itemId)?.book, quantity, used.get(itemId) ?? 0);
    };
    // Cheapest way to get `quantity` more of an item: buy it, or craft it from inputs.
    const cheapest = (itemId: number, quantity: number, skill: number): { cost: number; via?: Recipe } | null => {
      const buy = priceOf(itemId, quantity);
      const maker = makers.get(itemId);
      let craft: number | null = null;
      if (maker && canMake(maker, skill)) {
        craft = 0;
        for (const input of maker.reagents) {
          const cost = priceOf(input.itemId, (quantity * input.quantity) / maker.makes.quantity);
          if (cost === null) {
            craft = null;
            break;
          }
          craft += cost;
        }
      }
      if (craft !== null && maker && (buy === null || craft <= buy)) return { cost: craft, via: maker };
      return buy === null ? null : { cost: buy };
    };
    const stillNeeded = (reagent: { itemId: number; quantity: number }, crafts: number) =>
      Math.max(0, reagent.quantity * crafts - (made.get(reagent.itemId) ?? 0));

    for (let skill = reached; skill < to; skill++) {
      // `net` is the cost less what a vendor pays for the product.
      let best: { recipe: Recipe; crafts: number; cost: number; net: number } | undefined;
      const atSkill = new Map<Recipe, number>();
      costs.set(skill, atSkill);
      for (const recipe of profession.recipes) {
        const chance = skillUpChance(recipe, skill);
        if (chance === 0 || banned.has(`${recipe.spellId}@${skill}`)) continue;
        const crafts = 1 / chance;

        let cost = 0;
        for (const reagent of recipe.reagents) {
          const rest = stillNeeded(reagent, crafts);
          if (rest === 0) continue;
          const source = cheapest(reagent.itemId, rest, skill);
          if (!source) {
            cost = Infinity;
            break;
          }
          cost += source.cost;
        }
        const net = cost - Math.min(sellValue(recipe, crafts), cost * SALE_CREDIT);
        atSkill.set(recipe, net);
        if (net < (best?.net ?? Infinity)) best = { recipe, crafts, cost, net };
      }
      if (!best) break; // nothing can be crafted for this point
      if (dearest > 0 && best.cost > PRICE_JUMP * dearest) {
        tooDear = true;
        break;
      }
      dearest = Math.max(dearest, best.cost);

      choices.push({ skill, recipe: best.recipe, crafts: best.crafts });
      for (const reagent of best.recipe.reagents) {
        const need = reagent.quantity * best.crafts;
        const rest = stillNeeded(reagent, best.crafts);
        const via = rest > 0 ? cheapest(reagent.itemId, rest, skill)?.via : undefined;
        made.set(reagent.itemId, (made.get(reagent.itemId) ?? 0) - (need - rest));
        if (via) {
          for (const input of via.reagents) {
            used.set(input.itemId, (used.get(input.itemId) ?? 0) + (rest * input.quantity) / via.makes.quantity);
          }
        } else {
          used.set(reagent.itemId, (used.get(reagent.itemId) ?? 0) + rest);
        }
      }
      const product = best.recipe.makes;
      made.set(product.itemId, (made.get(product.itemId) ?? 0) + product.quantity * best.crafts);
    }

    groupAlternating(choices);
    absorbShortSteps(choices, costs);

    // Pass 2: group consecutive points on the same recipe into steps (never
    // across a tier break) and price each step exactly, walking the order books.
    let index = 0;

    while (index < choices.length) {
      const first = choices[index]!;
      let end = index;
      while (
        end < choices.length &&
        choices[end]!.recipe === first.recipe &&
        (end === index || !TIER_BREAKS.includes(choices[end]!.skill))
      ) {
        end++;
      }
      const fullEnd = end;

      // What it costs to buy `quantity` of an item on top of what is already bought.
      const buyLine = (itemId: number, quantity: number): StepMaterial | null => {
        const already = bought.get(itemId) ?? 0;
        const vendorPrice = vendor[itemId];
        const item = market.get(itemId);
        const cost = vendorPrice !== undefined ? vendorPrice * quantity : costToBuy(item?.book, quantity, already);
        if (cost === null) return null;
        return {
          itemId,
          name: nameOf(itemId),
          quantity,
          crafted: 0,
          cost,
          vendor: vendorPrice !== undefined,
          estimated: vendorPrice === undefined && already + quantity > (item?.exactUnits ?? 0),
        };
      };

      // The materials for `crafts` of this recipe; null if the market cannot supply them.
      const priceCrafts = (crafts: number): { materials: StepMaterial[]; spare: Array<[number, number]> } | null => {
        const materials: StepMaterial[] = [];
        const spare: Array<[number, number]> = []; // left over from crafting reagents
        for (const reagent of first.recipe.reagents) {
          const quantity = reagent.quantity * crafts;
          const crafted = Math.min(stock.get(reagent.itemId) ?? 0, quantity);
          const toBuy = quantity - crafted;
          const fromStock: StepMaterial = {
            ...buyLine(reagent.itemId, 0)!,
            quantity: crafted,
            crafted,
            cost: 0,
            estimated: false,
          };
          if (toBuy === 0) {
            materials.push(fromStock);
            continue;
          }

          const direct = buyLine(reagent.itemId, toBuy);
          const maker = makers.get(reagent.itemId);
          let inputs: StepMaterial[] | null = null;
          if (maker && canMake(maker, first.skill)) {
            const batches = Math.ceil(toBuy / maker.makes.quantity);
            const via = { name: nameOf(reagent.itemId), quantity: toBuy, saves: null as number | null };
            inputs = [];
            for (const input of maker.reagents) {
              const line = buyLine(input.itemId, input.quantity * batches);
              if (!line) {
                inputs = null;
                break;
              }
              inputs.push({ ...line, via });
            }
            const inputCost = inputs?.reduce((sum, line) => sum + line.cost, 0) ?? Infinity;
            if (inputs && direct && direct.cost < inputCost) inputs = null;
            if (direct) via.saves = direct.cost - inputCost;
            if (inputs) spare.push([reagent.itemId, batches * maker.makes.quantity - toBuy]);
          }

          if (inputs) {
            if (crafted > 0) materials.push(fromStock);
            materials.push(...inputs);
          } else if (direct) {
            materials.push({ ...direct, quantity, crafted });
          } else {
            return null;
          }
        }
        return { materials, spare };
      };
      const craftsTo = (stop: number) =>
        Math.ceil(choices.slice(index, stop).reduce((sum, choice) => sum + choice.crafts, 0) - 1e-9);

      // Rounding crafts up can need more than is listed; if so, cover fewer points.
      let priced = priceCrafts(craftsTo(end));
      while (!priced && end - 1 > index) priced = priceCrafts(craftsTo(--end));
      if (!priced) {
        banned.add(`${first.recipe.spellId}@${first.skill}`);
        replan = true;
        break;
      }
      const { materials, spare } = priced;
      const crafts = craftsTo(end);

      // What the step would cost if it stopped early, at every STOP_EVERY points.
      const stops: Array<{ skill: number; cost: number }> = [];
      for (let stop = index + 1; stop < end; stop++) {
        const skill = choices[stop]!.skill;
        const part = skill % STOP_EVERY === 0 ? priceCrafts(craftsTo(stop)) : null;
        if (part) stops.push({ skill, cost: part.materials.reduce((sum, m) => sum + m.cost, 0) });
      }

      for (const material of materials) {
        stock.set(material.itemId, (stock.get(material.itemId) ?? 0) - material.crafted);
        bought.set(material.itemId, (bought.get(material.itemId) ?? 0) + material.quantity - material.crafted);
      }
      const product = first.recipe.makes;
      for (const [itemId, quantity] of [...spare, [product.itemId, product.quantity * crafts] as const]) {
        stock.set(itemId, (stock.get(itemId) ?? 0) + quantity);
      }
      const last = choices[end - 1]!;
      steps.push({
        from: first.skill,
        to: last.skill + 1,
        spellId: first.recipe.spellId,
        recipeName: first.recipe.name,
        crafts,
        guaranteed: last.skill < first.recipe.yellow,
        plan: first.recipe.plan ?? false,
        materials,
        cost: materials.reduce((sum, m) => sum + m.cost, 0),
        sells: sellValue(first.recipe, crafts),
        stops,
      });
      reached = last.skill + 1;
      if (end < fullEnd) {
        replan = true;
        break;
      }
      index = end;
    }
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
      const { via: _via, ...line } = material;
      shopping.set(material.itemId, { ...line, quantity: toBuy, crafted: 0 });
    }
  }

  return {
    from,
    to,
    reached,
    complete: reached >= to,
    tooDear: tooDear && reached < to,
    totalCost: steps.reduce((sum, s) => sum + s.cost, 0),
    totalSells: steps.reduce((sum, s) => sum + s.sells, 0),
    brackets,
    steps,
    shopping: [...shopping.values()].sort((a, b) => b.cost - a.cost),
  };
}

// --- Database side ---

export interface MarketData {
  takenAt: number | null;
  market: Market;
  sellPrices: Map<number, number>; // what a vendor pays for each product, where known
}

// Order books for a profession's reagents, from the latest snapshot.
export function loadMarket(db: Db, houseId: number, profession: Profession): MarketData {
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
  const recipes = [...profession.recipes, ...(profession.reagentRecipes ?? [])];
  const productIds = [...new Set(recipes.map((recipe) => recipe.makes.itemId))].join(",");
  const sellPrices = new Map(
    db
      .prepare<[], { itemId: number; sellPrice: number }>(
        `SELECT item_id AS itemId, sell_price AS sellPrice FROM items WHERE item_id IN (${productIds}) AND sell_price > 0`,
      )
      .all()
      .map((row) => [row.itemId, row.sellPrice]),
  );
  if (!snapshot) return { takenAt: null, market: new Map(), sellPrices };

  const ids = [...new Set(recipes.flatMap((recipe) => recipe.reagents.map((r) => r.itemId)))];
  // The IDs are our own integers, so building the IN (...) list is safe.
  const idList = ids.join(",");

  const books = new Map<number, BookLevel[]>();
  const levels = db
    .prepare<[number], { itemId: number; unitPrice: number; quantity: number }>(
      `
      SELECT item_id AS itemId, unit_price AS unitPrice, quantity
      FROM price_levels
      WHERE snapshot_id = ? AND item_id IN (${idList})
      ORDER BY item_id, level
    `,
    )
    .all(snapshot.id);
  for (const { itemId, unitPrice, quantity } of levels) {
    let book = books.get(itemId);
    if (!book) books.set(itemId, (book = []));
    book.push({ unitPrice, quantity });
  }

  const totals = db
    .prepare<[number], { itemId: number; quantity: number; medianPrice: number }>(
      `
      SELECT item_id AS itemId, quantity, median_price AS medianPrice
      FROM commodity_prices
      WHERE snapshot_id = ? AND item_id IN (${idList})
    `,
    )
    .all(snapshot.id);

  const market = new Map<number, MarketItem>();
  for (const { itemId, quantity, medianPrice } of totals) {
    const book = books.get(itemId) ?? [];
    const exactUnits = book.reduce((sum, level) => sum + level.quantity, 0);
    // Units listed beyond the stored levels: assume the dearer of the last
    // stored price and the median.
    if (quantity > exactUnits) {
      book.push({
        unitPrice: Math.max(book.at(-1)?.unitPrice ?? 0, medianPrice),
        quantity: quantity - exactUnits,
      });
    }
    market.set(itemId, { book, exactUnits });
  }
  return { takenAt: snapshot.takenAt, market, sellPrices };
}
