import type { Helper, Profession } from "../levelling.js";
import { r } from "./recipe.js";

// Smelting recipes for WoW: Forever, from Wowhead's spell list (14 Nov 2026).
// Used to price bars from ore for a character who also has Mining. `learn` is
// the Mining skill needed. Bronze and Steel are written straight from ore.

const COAL = 3857;

export const MINING: Helper = {
  id: "mining",
  name: "Mining",
  recipes: [
    r(2657, "Smelt Copper", [1, 25, 70], [2840, 1], [[2770, 1]]),
    r(3304, "Smelt Tin", [65, 65, 75], [3576, 1], [[2771, 1]]),
    r(2659, "Smelt Bronze", [65, 65, 115], [2841, 2], [[2770, 1], [2771, 1]]),
    r(2658, "Smelt Silver", [75, 100, 125], [2842, 1], [[2775, 1]]),
    r(3307, "Smelt Iron", [125, 130, 140], [3575, 1], [[2772, 1]]),
    r(3308, "Smelt Gold", [155, 170, 185], [3577, 1], [[2776, 1]]),
    r(3569, "Smelt Steel", [165, 165, 165], [3859, 1], [[2772, 1], [COAL, 1]]),
    r(10097, "Smelt Mithril", [175, 175, 175], [3860, 1], [[3858, 1]]),
    r(10098, "Smelt Truesilver", [230, 230, 230], [6037, 1], [[7911, 1]]),
    r(16153, "Smelt Thorium", [250, 250, 250], [12359, 1], [[10620, 1]]),
  ],
  vendorPrices: { [COAL]: 500 },
  itemNames: {
    2770: "Copper Ore",
    2771: "Tin Ore",
    2772: "Iron Ore",
    2775: "Silver Ore",
    2776: "Gold Ore",
    [COAL]: "Coal",
    3858: "Mithril Ore",
    7911: "Truesilver Ore",
    10620: "Thorium Ore",
  },
};

// Levelling Mining by smelting. Only these smelts give skill, and none does
// between 140 and 155: that stretch is a free placeholder step (spell 0) for
// mining nodes. Past 185 it is nodes only.
export const SMELTING: Profession = {
  id: "mining",
  name: "Mining",
  recipes: [
    r(2657, "Smelt Copper", [1, 25, 70], [2840, 1], [[2770, 1]]),
    r(3304, "Smelt Tin", [65, 65, 75], [3576, 1], [[2771, 1]]),
    r(2659, "Smelt Bronze", [65, 65, 115], [2841, 2], [[2840, 1], [3576, 1]]),
    r(2658, "Smelt Silver", [75, 100, 125], [2842, 1], [[2775, 1]]),
    r(3307, "Smelt Iron", [125, 130, 140], [3575, 1], [[2772, 1]]),
    r(0, "Mine ore nodes: no smelt gives skill here", [140, 155, 155], [0, 0], []),
    r(3308, "Smelt Gold", [155, 170, 185], [3577, 1], [[2776, 1]]),
  ],
  vendorPrices: {},
  itemNames: { ...MINING.itemNames, 2840: "Copper Bar", 3576: "Tin Bar" },
};
