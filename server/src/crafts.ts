import type { Db } from "./db.js";
import { costToBuy } from "./favor.js";
import { estimateSales } from "./liquidity.js";
import { loadMarket, type Profession, type Recipe } from "./levelling.js";

// Which recipes make something that sells for more than its materials cost.
// The first craft is priced at the cheapest listings. Making more walks up the
// order book for each material, so each craft costs a little more; `count` is
// how many are worth making: until a craft costs more than it sells for, and
// no more than about a day's estimated sales. The sale price stays at the
// current cheapest: nothing here knows how far selling would push it down.
// Where a vendor pays more, the sale is to a vendor, with no day's-sales limit.
// Gear (sold one at a time) is priced from its cheapest listing or what a
// vendor pays, whichever is more, for a single craft: one more on the market
// is all a gear listing can be expected to sell.

// The most crafts worked out for one recipe.
const MAX_COUNT = 1000;

// Gear with fewer listings is priced at what a vendor pays: one or two
// listings are often asking prices nobody pays.
export const MIN_GEAR_LISTINGS = 3;

export interface CraftMaterial {
  itemId: number;
  name: string;
  quantity: number;
  unitCost: number;
  source: "vendor" | "auction" | "crafted"; // crafted = made from its own inputs, which was cheaper
}

export interface Craft {
  kind: "stack" | "gear";
  profession: { id: string; name: string };
  spellId: number;
  name: string;
  skill: number; // skill needed to learn it
  plan: boolean;
  productId: number;
  productName: string;
  makes: number;
  materials: CraftMaterial[];
  cost: number; // materials for one craft
  sale: number; // what one craft sells for, after the AH cut
  saleTo: "auction" | "vendor"; // a vendor pays more than the auction house, after its cut
  profit: number;
  listed: number; // units of the product on sale now (listings, for gear)
  count: number; // crafts the totals are for
  totalCost: number;
  totalProfit: number;
  limited: boolean; // fewer than asked for: the materials are not all on sale
  // What stopped the count when none was asked for: materials getting too dear, or a day's sales.
  heldBy: "materials" | "sales" | null;
  estimated: boolean; // part of the total is beyond the stored price levels
  soldPerDay: number | null; // estimate for the product, see liquidity.ts; null = too little history
}

export interface CraftData {
  takenAt: number | null;
  crafts: Craft[];
}

// `wanted` = crafts to price each recipe for; left out = as many as stay profitable.
export function findCrafts(
  db: Db,
  houseId: number,
  professions: Profession[],
  ahCut: number,
  wanted?: number,
): CraftData {
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
  if (!snapshot) return { takenAt: null, crafts: [] };

  type Price = { minPrice: number; quantity: number; name: string | null; sellPrice: number | null };
  const prices = new Map<number, Price>();
  const rows = db
    .prepare<[number], Price & { itemId: number }>(
      `
      SELECT p.item_id AS itemId, p.min_price AS minPrice, p.quantity, i.name, i.sell_price AS sellPrice
      FROM commodity_prices p
      LEFT JOIN items i ON i.item_id = p.item_id
      WHERE p.snapshot_id = ?
    `,
    )
    .all(snapshot.id);
  for (const row of rows) prices.set(row.itemId, row);

  const gearOf = db.prepare<
    { itemId: number; snapshotId: number },
    { name: string | null; kind: string; sellPrice: number | null; minBuyout: number | null; listed: number | null }
  >(`
    SELECT i.name, i.kind, i.sell_price AS sellPrice, p.min_buyout AS minBuyout, p.listing_count AS listed
    FROM items i
    LEFT JOIN item_prices p ON p.item_id = i.item_id AND p.snapshot_id = @snapshotId
    WHERE i.item_id = @itemId
  `);

  const sales = estimateSales(db, houseId);
  const crafts: Craft[] = [];
  for (const profession of professions) {
    const makers = new Map(profession.recipes.map((recipe) => [recipe.makes.itemId, recipe]));
    const vendor = profession.vendorPrices;
    const buyPrice = (itemId: number) => vendor[itemId] ?? prices.get(itemId)?.minPrice ?? null;
    // Cost of one unit made from its own inputs, all bought.
    const craftPrice = (recipe: Recipe | undefined): number | null => {
      if (!recipe || recipe.makes.quantity === 0) return null;
      let cost = 0;
      for (const input of recipe.reagents) {
        const price = buyPrice(input.itemId);
        if (price === null) return null;
        cost += price * input.quantity;
      }
      return cost / recipe.makes.quantity;
    };

    const { market } = loadMarket(db, houseId, profession);
    // Cost of `quantity` of an item bought outright, walking its order book.
    const buyCost = (itemId: number, quantity: number): { cost: number; estimated: boolean } | null => {
      const vendorPrice = vendor[itemId];
      if (vendorPrice !== undefined) return { cost: vendorPrice * quantity, estimated: false };
      const item = market.get(itemId);
      const cost = costToBuy(item?.book, quantity);
      return cost === null ? null : { cost, estimated: quantity > (item?.exactUnits ?? 0) };
    };
    // Materials for `count` crafts; each reagent is bought or made, whichever is cheaper.
    const totalFor = (recipe: Recipe, count: number): { cost: number; estimated: boolean } | null => {
      let cost = 0;
      let estimated = false;
      for (const reagent of recipe.reagents) {
        const need = reagent.quantity * count;
        const bought = buyCost(reagent.itemId, need);
        const maker = makers.get(reagent.itemId);
        let made: { cost: number; estimated: boolean } | null = null;
        if (maker && maker.makes.quantity > 0) {
          const batches = Math.ceil(need / maker.makes.quantity);
          made = { cost: 0, estimated: false };
          for (const input of maker.reagents) {
            const part = buyCost(input.itemId, input.quantity * batches);
            if (!part) {
              made = null;
              break;
            }
            made = { cost: made.cost + part.cost, estimated: made.estimated || part.estimated };
          }
        }
        const best = made && (!bought || made.cost < bought.cost) ? made : bought;
        if (!best) return null;
        cost += best.cost;
        estimated ||= best.estimated;
      }
      return { cost, estimated };
    };
    // Largest count from 1 to `max` that passes; passing counts come before failing ones.
    const lastPassing = (max: number, passes: (count: number) => boolean): number => {
      let low = 0;
      let high = max;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (passes(middle)) low = middle;
        else high = middle - 1;
      }
      return low;
    };

    for (const recipe of profession.recipes) {
      if (recipe.makes.quantity === 0) continue;
      const product = prices.get(recipe.makes.itemId);
      const gear = product ? undefined : gearOf.get({ itemId: recipe.makes.itemId, snapshotId: snapshot.id });
      const gearSale =
        gear && (gear.listed ?? 0) >= MIN_GEAR_LISTINGS ? Math.floor((gear.minBuyout ?? 0) * (1 - ahCut)) : 0;
      const vendorSale = gear?.sellPrice ?? 0;
      if (!product && gearSale <= 0 && vendorSale <= 0) continue; // not on sale and no vendor price

      const materials: CraftMaterial[] = [];
      for (const reagent of recipe.reagents) {
        const bought = buyPrice(reagent.itemId);
        const crafted = craftPrice(makers.get(reagent.itemId));
        const useCrafted = crafted !== null && (bought === null || crafted < bought);
        const unitCost = useCrafted ? crafted : bought;
        if (unitCost === null) break;
        materials.push({
          itemId: reagent.itemId,
          name: profession.itemNames[reagent.itemId] ?? `Item #${reagent.itemId}`,
          quantity: reagent.quantity,
          unitCost: Math.round(unitCost),
          source: useCrafted ? "crafted" : vendor[reagent.itemId] !== undefined ? "vendor" : "auction",
        });
      }
      if (materials.length < recipe.reagents.length) continue; // a material is not on sale

      const cost = materials.reduce((sum, m) => sum + m.unitCost * m.quantity, 0);
      // A commodity not listed right now can still go to a vendor.
      if (!product && gear?.kind !== "commodity") {
        crafts.push({
          kind: "gear",
          profession: { id: profession.id, name: profession.name },
          spellId: recipe.spellId,
          name: recipe.name,
          skill: recipe.learn,
          plan: recipe.plan ?? false,
          productId: recipe.makes.itemId,
          // Many items new to Forever have no name from Blizzard; the recipe's name is the item's.
          productName: gear?.name ?? recipe.name,
          makes: 1,
          materials,
          cost,
          sale: Math.max(gearSale, vendorSale),
          saleTo: vendorSale > gearSale ? "vendor" : "auction",
          profit: Math.max(gearSale, vendorSale) - cost,
          listed: gear?.listed ?? 0,
          count: 1,
          totalCost: cost,
          totalProfit: Math.max(gearSale, vendorSale) - cost,
          limited: false,
          heldBy: null,
          estimated: false,
          soldPerDay: null,
        });
        continue;
      }

      const auctionSale = product ? Math.floor(product.minPrice * recipe.makes.quantity * (1 - ahCut)) : 0;
      const vendorPays = ((product ? product.sellPrice : gear?.sellPrice) ?? 0) * recipe.makes.quantity;
      const toVendor = vendorPays > auctionSale;
      const sale = Math.max(auctionSale, vendorPays);

      const soldPerDay = sales.soldPerDay.size > 0 ? (sales.soldPerDay.get(recipe.makes.itemId) ?? 0) : null;
      let count: number;
      let heldBy: Craft["heldBy"] = null;
      if (wanted !== undefined) {
        count = lastPassing(Math.min(wanted, MAX_COUNT), (n) => totalFor(recipe, n) !== null);
      } else {
        // Worth making while the next craft still costs less than it sells for.
        count = lastPassing(MAX_COUNT, (n) => {
          const upTo = totalFor(recipe, n);
          const before = n === 1 ? { cost: 0 } : totalFor(recipe, n - 1);
          return upTo !== null && before !== null && upTo.cost - before.cost < sale;
        });
        if (count < MAX_COUNT) heldBy = "materials";
        // No point making more than sell in a day; a vendor takes any number.
        if (soldPerDay !== null && !toVendor) {
          const aDaysSales = Math.max(1, Math.floor(soldPerDay / recipe.makes.quantity));
          if (aDaysSales < count) {
            count = aDaysSales;
            heldBy = "sales";
          }
        }
      }
      const total = (count > 0 ? totalFor(recipe, count) : null) ?? { cost, estimated: false };
      count = Math.max(count, 1);

      crafts.push({
        kind: "stack",
        profession: { id: profession.id, name: profession.name },
        spellId: recipe.spellId,
        name: recipe.name,
        skill: recipe.learn,
        plan: recipe.plan ?? false,
        productId: recipe.makes.itemId,
        productName:
          product?.name ?? gear?.name ?? profession.itemNames[recipe.makes.itemId] ?? `Item #${recipe.makes.itemId}`,
        makes: recipe.makes.quantity,
        materials,
        cost,
        sale,
        saleTo: toVendor ? "vendor" : "auction",
        profit: sale - cost,
        listed: product?.quantity ?? 0,
        count,
        totalCost: total.cost,
        totalProfit: sale * count - total.cost,
        limited: wanted !== undefined && count < Math.min(wanted, MAX_COUNT),
        heldBy,
        estimated: total.estimated,
        soldPerDay,
      });
    }
  }

  crafts.sort((a, b) => b.totalProfit - a.totalProfit);
  return { takenAt: snapshot.takenAt, crafts };
}
