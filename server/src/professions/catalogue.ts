import { readFileSync } from "node:fs";
import type { Profession, Recipe } from "../levelling.js";

// Every recipe that makes an item, per profession, from Wowhead's profession
// lists (22 Nov 2026), for Crafts. Levelling keeps its own hand-checked lists.
// Specialisation recipes are left out: the character profile has no
// specialisation. Source: a trainer teaches it, a vendor sells it, or it has
// to be bought from another player ("bought": drops and the rest), which
// Crafts only shows once the recipe item has been seen on the auction house.
// Vendor recipes are not checked for reputation.

type Row = [
  spellId: number,
  name: string,
  learn: number,
  yellow: number,
  grey: number,
  itemId: number,
  quantity: number,
  reagents: Array<[number, number]>,
  source: "t" | "v" | "b",
];
const SOURCES = { t: "trainer", v: "vendor", b: "bought" } as const;

const rows = JSON.parse(readFileSync(new URL("./catalogue.json", import.meta.url), "utf8")) as Record<string, Row[]>;

export function catalogueRecipes(professionId: string): Recipe[] {
  return (rows[professionId] ?? []).map(([spellId, name, learn, yellow, grey, itemId, quantity, reagents, source]) => ({
    spellId,
    name,
    learn,
    yellow,
    grey,
    makes: { itemId, quantity },
    reagents: reagents.map(([id, count]) => ({ itemId: id, quantity: count })),
    source: SOURCES[source],
  }));
}

// The profession's own recipes, each given its catalogue source, plus every
// other catalogue recipe.
export function withCatalogue(profession: Profession): Profession {
  const extra = catalogueRecipes(profession.id);
  const sourceOf = new Map(extra.map((recipe) => [recipe.spellId, recipe.source]));
  const own = new Set(profession.recipes.map((recipe) => recipe.spellId));
  return {
    ...profession,
    recipes: [
      ...profession.recipes.map((recipe) => {
        const source = recipe.source ?? sourceOf.get(recipe.spellId) ?? (recipe.plan ? "bought" : "trainer");
        return { ...recipe, source };
      }),
      ...extra.filter((recipe) => !own.has(recipe.spellId)),
    ],
  };
}
