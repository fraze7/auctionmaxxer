import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { recipeKey } from "../plans.js";
import { ALCHEMY } from "./alchemy.js";
import { catalogueRecipes, withCatalogue } from "./catalogue.js";
import { CRAFT_PROFESSIONS } from "./index.js";

describe("recipe catalogue", () => {
  it("has recipes that make something from something, for every Crafts profession but Mining", () => {
    for (const profession of CRAFT_PROFESSIONS.filter((p) => p.id !== "mining")) {
      const recipes = catalogueRecipes(profession.id);
      assert.ok(recipes.length > 20, profession.id);
      for (const recipe of recipes) {
        assert.ok(recipe.makes.itemId > 0 && recipe.makes.quantity > 0, recipe.name);
        assert.ok(recipe.reagents.length > 0 && recipe.learn > 0, recipe.name);
      }
    }
  });

  it("keeps a profession's own recipes and adds the rest once each", () => {
    const full = withCatalogue(ALCHEMY);
    assert.deepEqual(full.recipes.slice(0, ALCHEMY.recipes.length).map((r) => r.spellId), ALCHEMY.recipes.map((r) => r.spellId));
    const ids = full.recipes.map((r) => r.spellId);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(full.recipes.every((r) => r.source !== undefined));
  });

  it("matches recipe items to spells whatever the colon", () => {
    assert.equal(recipeKey("Recipe: Transmute Arcanite"), recipeKey("Transmute: Arcanite"));
    assert.equal(recipeKey("Pattern: Mooncloth Bag"), "mooncloth bag");
  });
});
