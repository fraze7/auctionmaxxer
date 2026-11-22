import type { Profession } from "../levelling.js";
import { ALCHEMY } from "./alchemy.js";
import { BLACKSMITHING } from "./blacksmithing.js";
import { withCatalogue } from "./catalogue.js";
import { COOKING } from "./cooking.js";
import { ENCHANTING } from "./enchanting.js";
import { ENGINEERING } from "./engineering.js";
import { LEATHERWORKING } from "./leatherworking.js";
import { SMELTING } from "./mining.js";
import { TAILORING } from "./tailoring.js";

// Every profession the site covers, in the order the tabs show them.
export const PROFESSIONS = {
  alchemy: ALCHEMY,
  blacksmithing: BLACKSMITHING,
  tailoring: TAILORING,
  leatherworking: LEATHERWORKING,
  engineering: ENGINEERING,
  enchanting: ENCHANTING,
  mining: SMELTING,
} satisfies Record<string, Profession>;

export const ALL_PROFESSIONS: Profession[] = Object.values(PROFESSIONS);

// Crafts and the character profile: every profession with its full recipe
// catalogue, plus Cooking.
export const CRAFT_PROFESSIONS: Profession[] = [...ALL_PROFESSIONS, COOKING].map(withCatalogue);
