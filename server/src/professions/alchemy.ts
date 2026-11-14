import type { Profession, Recipe } from "../levelling.js";

// Alchemy recipes for WoW: Forever, from Wowhead's spell list (14 Nov 2026).
// Only recipes taught by a trainer, plus the two starting recipes. Left out:
// drops, vendor and quest recipes, transmutes (cooldown) and Mana Well (never
// gives skill).

// r(spell, name, [orange, yellow, grey], [item, quantity], reagents)
// Wowhead gives orange 0 for a few recipes; their real learn level is unknown,
// so they are treated as learnable from yellow.
const r = (
  spellId: number,
  name: string,
  [orange, yellow, grey]: [number, number, number],
  [itemId, quantity]: [number, number],
  reagents: Array<[number, number]>,
): Recipe => ({
  spellId,
  name,
  learn: orange > 0 ? orange : yellow,
  yellow,
  grey,
  makes: { itemId, quantity },
  reagents: reagents.map(([id, qty]) => ({ itemId: id, quantity: qty })),
});

const VIAL = 3371;
const LEADED = 3372;
const CRYSTAL = 8925;

const RECIPES: Recipe[] = [
  // Known from skill 1.
  r(1245246, "Minor Arcane Elixir", [1, 10, 15], [247754, 1], [[2447, 1], [VIAL, 1]]),
  r(1245250, "Elixir of Minor Force", [1, 10, 15], [247755, 1], [[765, 1], [VIAL, 1]]),

  r(2329, "Elixir of Minor Strength", [15, 55, 95], [2454, 1], [[2449, 1], [765, 1], [VIAL, 1]]),
  r(3170, "Minor Troll's Blood Elixir", [15, 60, 100], [3382, 1], [[2447, 1], [2449, 2], [VIAL, 1]]),
  r(2331, "Minor Mana Potion", [25, 65, 105], [2455, 1], [[785, 1], [2447, 1], [VIAL, 1]]),
  r(2332, "Minor Rejuvenation Potion", [40, 70, 110], [2456, 1], [[785, 2], [2447, 1], [VIAL, 1]]),
  r(1249630, "Cerulean Dye", [40, 50, 90], [249409, 1], [[249399, 2], [VIAL, 1]]),
  r(1249633, "Sulfuric Acid", [40, 50, 90], [249410, 1], [[249391, 2], [VIAL, 1]]),
  r(2334, "Elixir of Minor Fortitude", [50, 80, 120], [2458, 1], [[2449, 2], [2447, 1], [VIAL, 1]]),
  r(4508, "Minor Discolored Healing Potion", [50, 55, 95], [4596, 1], [[VIAL, 1], [2447, 1], [730, 1]]),
  r(7836, "Blackmouth Oil", [80, 80, 100], [6370, 1], [[6358, 2], [VIAL, 1]]),
  r(1244645, "Lesser Discolored Healing Potion", [0, 85, 125], [247239, 1], [[VIAL, 1], [2450, 1], [730, 1]]),
  r(3171, "Elixir of Wisdom", [90, 120, 160], [3383, 1], [[785, 1], [2450, 2], [VIAL, 1]]),
  r(7179, "Draught of Water Breathing", [90, 120, 160], [5996, 1], [[3820, 1], [6370, 2], [VIAL, 1]]),
  r(7841, "Swim Speed Potion", [100, 130, 170], [6372, 1], [[2452, 1], [6370, 1], [VIAL, 1]]),
  r(3173, "Lesser Mana Potion", [120, 145, 185], [3385, 1], [[785, 1], [3820, 1], [VIAL, 1]]),
  r(1249631, "Magenta Dye", [120, 130, 155], [249430, 1], [[249424, 2], [LEADED, 1]]),
  r(3176, "Lesser Troll's Blood Elixir", [125, 150, 190], [3388, 1], [[2453, 2], [2450, 2], [LEADED, 1]]),
  r(3177, "Elixir of Lesser Defense", [130, 155, 195], [3389, 1], [[3355, 1], [3820, 1], [LEADED, 1]]),
  r(7837, "Fire Oil", [130, 150, 170], [6371, 2], [[6359, 2], [VIAL, 1]]),
  r(1244646, "Discolored Healing Potion", [0, 135, 175], [247240, 1], [[LEADED, 1], [2453, 1], [730, 1]]),
  r(7845, "Elixir of Fire Power", [140, 165, 205], [6373, 1], [[6371, 2], [3356, 1], [LEADED, 1]]),
  r(3452, "Mana Potion", [160, 180, 220], [3827, 1], [[3820, 1], [3356, 1], [LEADED, 1]]),
  r(3448, "Lesser Invisibility Potion", [165, 185, 225], [3823, 1], [[3818, 1], [3355, 1], [LEADED, 1]]),
  r(3450, "Elixir of Lesser Fortitude", [175, 195, 235], [3825, 1], [[3355, 1], [3821, 1], [LEADED, 1]]),
  r(1244647, "Greater Discolored Healing Potion", [0, 175, 215], [247241, 1], [[LEADED, 1], [3356, 1], [730, 1]]),
  r(11449, "Elixir of Agility", [185, 205, 245], [8949, 1], [[3820, 1], [3821, 1], [LEADED, 1]]),
  r(11450, "Elixir of Defense", [195, 215, 255], [8951, 1], [[3355, 1], [3821, 1], [LEADED, 1]]),
  r(12609, "Catseye Draught", [200, 220, 260], [10592, 1], [[3821, 1], [3818, 1], [LEADED, 1]]),
  r(11448, "Greater Mana Potion", [205, 220, 260], [6149, 1], [[3358, 1], [3821, 1], [LEADED, 1]]),
  r(11451, "Oil of Immolation", [205, 220, 260], [8956, 1], [[4625, 1], [3821, 1], [CRYSTAL, 1]]),
  r(22808, "Draught of Greater Water Breathing", [215, 230, 270], [18294, 1], [[7972, 1], [8831, 2], [CRYSTAL, 1]]),
  r(1249632, "Viridian Dye", [215, 230, 270], [249431, 1], [[249274, 2], [CRYSTAL, 1]]),
  r(11460, "Draught of Detect Undead", [230, 245, 285], [9154, 1], [[8836, 1], [CRYSTAL, 1]]),
  r(15833, "Dreamless Sleep Potion", [230, 245, 285], [12190, 1], [[8831, 3], [CRYSTAL, 1]]),
  r(1244648, "Superior Discolored Healing Potion", [0, 230, 270], [247242, 1], [[CRYSTAL, 1], [8838, 1], [730, 1]]),
  r(11461, "Arcane Elixir", [235, 250, 290], [9155, 1], [[8839, 1], [3821, 1], [CRYSTAL, 1]]),
  r(11465, "Elixir of Greater Intellect", [235, 250, 290], [9179, 1], [[8839, 1], [3358, 1], [CRYSTAL, 1]]),
  r(11467, "Elixir of Greater Agility", [240, 255, 295], [9187, 1], [[8838, 1], [3821, 1], [CRYSTAL, 1]]),
  r(11478, "Draught of Detect Demon", [250, 265, 305], [9233, 1], [[8846, 2], [CRYSTAL, 1]]),
  r(17551, "Stonescale Oil", [250, 250, 260], [13423, 2], [[13422, 1], [LEADED, 1]]),
  r(1231583, "Major Discolored Healing Potion", [250, 290, 330], [241650, 1], [[CRYSTAL, 1], [13466, 1], [730, 1]]),
];

export const ALCHEMY: Profession = {
  id: "alchemy",
  name: "Alchemy",
  recipes: RECIPES,
  // Sold by trade vendors; prices from Wowhead.
  vendorPrices: { [VIAL]: 20, [LEADED]: 200, [CRYSTAL]: 2500 },
  itemNames: {
    730: "Murloc Eye",
    765: "Silverleaf",
    785: "Mageroyal",
    2447: "Peacebloom",
    2449: "Earthroot",
    2450: "Briarthorn",
    2452: "Swiftthistle",
    2453: "Bruiseweed",
    3355: "Wild Steelbloom",
    3356: "Kingsblood",
    3358: "Khadgar's Whisker",
    [VIAL]: "Empty Vial",
    [LEADED]: "Leaded Vial",
    3818: "Fadeleaf",
    3820: "Stranglekelp",
    3821: "Goldthorn",
    4625: "Firebloom",
    6358: "Oily Blackmouth",
    6359: "Firefin Snapper",
    6370: "Blackmouth Oil",
    6371: "Fire Oil",
    7972: "Ichor of Undeath",
    8831: "Purple Lotus",
    8836: "Arthas' Tears",
    8838: "Sungrass",
    8839: "Blindweed",
    8846: "Gromsblood",
    [CRYSTAL]: "Crystal Vial",
    13422: "Stonescale Eel",
    13466: "Plaguebloom",
    249274: "Stranglevine",
    249391: "Pyrite",
    249399: "Frilled Lichen",
    249424: "Rosecap",
  },
};
