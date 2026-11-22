import type { Profession } from "../levelling.js";

// Cooking, for Crafts only: its recipes all come from catalogue.json, and
// Levelling does not cover it.
export const COOKING: Profession = {
  id: "cooking",
  name: "Cooking",
  recipes: [],
  vendorPrices: {},
  itemNames: {},
};
