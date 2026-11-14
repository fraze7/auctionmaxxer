import type { Db } from "./db.js";
import type { Profession, Recipe } from "./levelling.js";

// Which recipes make something that sells for more than its materials cost.
// Prices are the cheapest listing in the latest snapshot, so the figures hold
// for a craft or two, not a whole stack. Only products sold as commodities
// can be priced; crafted gear is not tracked.

export interface CraftMaterial {
  itemId: number;
  name: string;
  quantity: number;
  unitCost: number;
  source: "vendor" | "auction" | "crafted"; // crafted = made from its own inputs, which was cheaper
}

export interface Craft {
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
  profit: number;
  listed: number; // units of the product on sale now
}

export interface CraftData {
  takenAt: number | null;
  crafts: Craft[];
}

export function findCrafts(db: Db, houseId: number, professions: Profession[], ahCut: number): CraftData {
  const snapshot = db
    .prepare<[number], { id: number; takenAt: number }>(`
      SELECT id, taken_at AS takenAt
      FROM snapshots
      WHERE house_id = ? AND kind = 'commodities' AND status = 'ok'
      ORDER BY taken_at DESC
      LIMIT 1
    `)
    .get(houseId);
  if (!snapshot) return { takenAt: null, crafts: [] };

  const prices = new Map<number, { minPrice: number; quantity: number; name: string | null }>();
  const rows = db
    .prepare<[number], { itemId: number; minPrice: number; quantity: number; name: string | null }>(`
      SELECT p.item_id AS itemId, p.min_price AS minPrice, p.quantity, i.name
      FROM commodity_prices p
      LEFT JOIN items i ON i.item_id = p.item_id
      WHERE p.snapshot_id = ?
    `)
    .all(snapshot.id);
  for (const row of rows) prices.set(row.itemId, row);

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

    for (const recipe of profession.recipes) {
      const product = prices.get(recipe.makes.itemId);
      if (!product || recipe.makes.quantity === 0) continue;

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
      const sale = Math.floor(product.minPrice * recipe.makes.quantity * (1 - ahCut));
      crafts.push({
        profession: { id: profession.id, name: profession.name },
        spellId: recipe.spellId,
        name: recipe.name,
        skill: recipe.learn,
        plan: recipe.plan ?? false,
        productId: recipe.makes.itemId,
        productName: product.name ?? profession.itemNames[recipe.makes.itemId] ?? `Item #${recipe.makes.itemId}`,
        makes: recipe.makes.quantity,
        materials,
        cost,
        sale,
        profit: sale - cost,
        listed: product.quantity,
      });
    }
  }

  crafts.sort((a, b) => b.profit - a.profit);
  return { takenAt: snapshot.takenAt, crafts };
}
