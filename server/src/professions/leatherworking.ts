import type { Profession, Recipe } from "../levelling.js";
import { r } from "./recipe.js";

// Leatherworking recipes for WoW: Forever, from Wowhead's spell list (14 Nov
// 2026). Trainer recipes and the six starting recipes, plus two patterns sold
// by vendors with no reputation needed (checked in game): trainer recipes stop
// giving points at 265. Left out: anything needing a specialisation (Chimeric
// Gloves need Tribal), drops, quest and reputation patterns.

const COARSE_THREAD = 2320;
const FINE_THREAD = 2321;
const SILKEN_THREAD = 4291;
const HEAVY_SILKEN_THREAD = 8343;
const RUNE_THREAD = 14341;
const BLACK_DYE = 2325;
const GREEN_DYE = 2605;
const GRAY_DYE = 4340;
const SALT = 4289;

const LIGHT = 2318;
const MEDIUM = 2319;
const HEAVY = 4234;
const THICK = 4304;
const RUGGED = 8170;

const RECIPES: Recipe[] = [
  // Known from skill 1.
  r(2881, "Light Leather", [1, 20, 40], [LIGHT, 1], [[2934, 3]]),
  r(2152, "Light Armor Kit", [1, 30, 60], [2304, 1], [[LIGHT, 1]]),
  r(2149, "Handstitched Leather Boots", [1, 40, 70], [2302, 1], [[LIGHT, 2], [COARSE_THREAD, 1]]),
  r(7126, "Handstitched Leather Vest", [1, 40, 70], [5957, 1], [[LIGHT, 3], [COARSE_THREAD, 1]]),
  r(9058, "Handstitched Leather Cloak", [1, 40, 70], [7276, 1], [[LIGHT, 2], [COARSE_THREAD, 1]]),
  r(9059, "Handstitched Leather Bracers", [1, 40, 70], [7277, 1], [[LIGHT, 2], [COARSE_THREAD, 3]]),

  r(1255143, "Moonglow Boots", [35, 40, 40], [252427, 1], [[LIGHT, 12], [4231, 2], [5498, 1]]),
  r(1255144, "Murloc Scale Shoes", [35, 40, 40], [252426, 1], [[LIGHT, 12], [4231, 2], [5784, 4]]),
  r(1255145, "Dark Leather Boots", [35, 40, 40], [252425, 1], [[LIGHT, 24], [4231, 2], [GRAY_DYE, 1]]),
  r(1255146, "Black Whelp Slippers", [35, 40, 40], [252424, 1], [[LIGHT, 12], [4231, 2], [7286, 2]]),
  r(2153, "Handstitched Leather Pants", [15, 45, 75], [2303, 1], [[LIGHT, 4], [COARSE_THREAD, 1]]),
  r(3816, "Cured Light Hide", [30, 50, 70], [4231, 1], [[783, 1], [SALT, 1]]),
  r(3753, "Handstitched Leather Belt", [25, 55, 85], [4237, 1], [[LIGHT, 6], [COARSE_THREAD, 1]]),
  r(9060, "Light Leather Quiver", [25, 55, 85], [7278, 1], [[LIGHT, 4], [COARSE_THREAD, 2]]),
  r(9062, "Small Leather Ammo Pouch", [25, 55, 85], [7279, 1], [[LIGHT, 3], [COARSE_THREAD, 4]]),
  r(2160, "Embossed Leather Vest", [35, 65, 95], [2300, 1], [[LIGHT, 8], [COARSE_THREAD, 4]]),
  r(2159, "Fine Leather Cloak", [50, 70, 100], [2308, 1], [[LIGHT, 10], [FINE_THREAD, 2]]),
  r(2162, "Embossed Leather Cloak", [40, 70, 100], [2310, 1], [[LIGHT, 5], [COARSE_THREAD, 2]]),
  r(3756, "Embossed Leather Gloves", [40, 70, 100], [4239, 1], [[LIGHT, 3], [COARSE_THREAD, 2]]),
  r(9065, "Light Leather Bracers", [45, 75, 105], [7281, 1], [[LIGHT, 6], [COARSE_THREAD, 4]]),
  r(20648, "Medium Leather", [75, 75, 85], [MEDIUM, 1], [[LIGHT, 4]]),
  r(2161, "Embossed Leather Boots", [50, 80, 110], [2309, 1], [[LIGHT, 8], [COARSE_THREAD, 5]]),
  r(3759, "Embossed Leather Pants", [50, 80, 110], [4242, 1], [[4231, 1], [LIGHT, 6], [COARSE_THREAD, 2]]),
  r(3763, "Fine Leather Belt", [55, 85, 115], [4246, 1], [[LIGHT, 6], [COARSE_THREAD, 2]]),
  r(2165, "Medium Armor Kit", [75, 90, 105], [2313, 1], [[MEDIUM, 4], [COARSE_THREAD, 1]]),
  r(3761, "Fine Leather Tunic", [60, 90, 120], [4243, 1], [[4231, 3], [LIGHT, 6], [COARSE_THREAD, 4]]),
  r(3817, "Cured Medium Hide", [75, 90, 105], [4233, 1], [[4232, 1], [SALT, 1]]),
  r(2167, "Gray Leather Boots", [75, 100, 125], [2315, 1], [[MEDIUM, 4], [FINE_THREAD, 2], [GRAY_DYE, 1]]),
  r(9068, "Light Leather Pants", [70, 100, 130], [7282, 1], [[LIGHT, 10], [4231, 1], [FINE_THREAD, 1]]),
  r(2168, "Dark Leather Cloak", [85, 110, 135], [2316, 1], [[MEDIUM, 8], [FINE_THREAD, 1], [GRAY_DYE, 1]]),
  r(7135, "Dark Leather Pants", [90, 115, 140], [5961, 1], [[MEDIUM, 12], [GRAY_DYE, 1], [FINE_THREAD, 1]]),
  r(2166, "Toughened Leather Armor", [95, 120, 145], [2314, 1], [[MEDIUM, 10], [4231, 2], [FINE_THREAD, 2]]),
  r(9074, "Nimble Leather Gloves", [95, 120, 145], [7285, 1], [[2457, 1], [MEDIUM, 6], [FINE_THREAD, 1]]),
  r(3766, "Dark Leather Belt", [100, 125, 150], [4249, 1], [[4246, 1], [4233, 1], [FINE_THREAD, 2], [GRAY_DYE, 1]]),
  r(9145, "Fletcher's Gloves", [100, 125, 150], [7348, 1], [[MEDIUM, 8], [5116, 4], [FINE_THREAD, 2]]),
  r(20649, "Heavy Leather", [125, 125, 135], [HEAVY, 1], [[MEDIUM, 5]]),
  r(3768, "Hillman's Shoulders", [105, 130, 155], [4251, 1], [[4233, 1], [MEDIUM, 4], [FINE_THREAD, 1]]),
  r(3770, "Toughened Leather Gloves", [110, 135, 160], [4253, 1], [[MEDIUM, 4], [4233, 2], [3389, 2], [3182, 2], [FINE_THREAD, 2]]),
  r(3818, "Cured Heavy Hide", [125, 135, 145], [4236, 1], [[4235, 1], [SALT, 3]]),
  r(3760, "Hillman's Cloak", [125, 145, 165], [3719, 1], [[HEAVY, 5], [FINE_THREAD, 2]]),
  r(3764, "Hillman's Leather Gloves", [120, 145, 170], [4247, 1], [[MEDIUM, 14], [FINE_THREAD, 4]]),
  r(3780, "Heavy Armor Kit", [125, 145, 165], [4265, 1], [[HEAVY, 5], [FINE_THREAD, 1]]),
  r(9193, "Heavy Quiver", [125, 145, 165], [7371, 1], [[HEAVY, 8], [FINE_THREAD, 2]]),
  r(9194, "Heavy Leather Ammo Pouch", [125, 145, 165], [7372, 1], [[HEAVY, 8], [FINE_THREAD, 2]]),
  r(3774, "Green Leather Belt", [135, 155, 175], [4257, 1], [[4236, 1], [HEAVY, 5], [FINE_THREAD, 1], [GREEN_DYE, 1], [7071, 1]]),
  r(7147, "Guardian Pants", [135, 155, 175], [5962, 1], [[HEAVY, 12], [4305, 2], [FINE_THREAD, 2]]),
  r(1255075, "Mender's Leather Belt", [150, 155, 155], [252523, 1], [[HEAVY, 8], [4233, 2], [5500, 1]]),
  r(1255076, "Skycaller's Leather Belt", [150, 155, 155], [252522, 1], [[HEAVY, 8], [4233, 2], [7070, 1]]),
  r(1255077, "Skirmisher's Leather Belt", [150, 155, 155], [252461, 1], [[HEAVY, 8], [4233, 2], [3864, 1]]),
  r(1255078, "Warden's Leather Belt", [150, 155, 155], [252460, 1], [[HEAVY, 8], [4233, 2], [7067, 1]]),
  r(1255079, "Stalker's Leather Belt", [150, 155, 155], [252521, 1], [[HEAVY, 8], [4233, 2], [7069, 1]]),
  r(1255080, "Skulker's Leather Belt", [150, 155, 155], [252520, 1], [[HEAVY, 8], [4233, 2], [3182, 1]]),
  r(1255081, "Prowler's Leather Belt", [150, 155, 155], [252459, 1], [[HEAVY, 8], [4233, 2], [1529, 1]]),
  r(7151, "Barbaric Shoulders", [150, 170, 190], [5964, 1], [[HEAVY, 8], [4236, 1], [FINE_THREAD, 2]]),
  r(9196, "Dusky Leather Armor", [150, 170, 190], [7374, 1], [[HEAVY, 10], [3824, 1], [FINE_THREAD, 2]]),
  r(3776, "Green Leather Bracers", [155, 175, 195], [4259, 1], [[4236, 2], [HEAVY, 6], [GREEN_DYE, 1], [FINE_THREAD, 1]]),
  r(9198, "Frost Leather Cloak", [155, 175, 195], [7377, 1], [[HEAVY, 6], [7067, 2], [7070, 2], [FINE_THREAD, 2]]),
  r(20650, "Thick Leather", [175, 175, 180], [THICK, 1], [[HEAVY, 6]]),
  r(9201, "Dusky Bracers", [160, 180, 200], [7378, 1], [[HEAVY, 16], [BLACK_DYE, 1], [SILKEN_THREAD, 2]]),
  r(6661, "Barbaric Harness", [165, 185, 205], [5739, 1], [[HEAVY, 14], [FINE_THREAD, 2], [7071, 1]]),
  r(7156, "Guardian Gloves", [165, 185, 205], [5966, 1], [[HEAVY, 4], [4236, 1], [SILKEN_THREAD, 1]]),
  r(9206, "Dusky Belt", [170, 190, 210], [7387, 1], [[HEAVY, 10], [4305, 2], [BLACK_DYE, 2], [7071, 1]]),
  r(10487, "Thick Armor Kit", [175, 195, 215], [8173, 1], [[THICK, 5], [SILKEN_THREAD, 1]]),
  r(10499, "Nightscape Tunic", [180, 200, 220], [8175, 1], [[THICK, 7], [SILKEN_THREAD, 2]]),
  r(10507, "Nightscape Headband", [180, 200, 220], [8176, 1], [[THICK, 5], [SILKEN_THREAD, 2]]),
  r(10511, "Turtle Scale Breastplate", [185, 205, 225], [8189, 1], [[THICK, 6], [8167, 12], [HEAVY_SILKEN_THREAD, 1]]),
  r(10518, "Turtle Scale Bracers", [185, 205, 225], [8198, 1], [[THICK, 8], [8167, 12], [HEAVY_SILKEN_THREAD, 1]]),
  r(10621, "Wolfshead Helm", [200, 220, 240], [8345, 1], [[THICK, 18], [8368, 2], [8146, 8], [HEAVY_SILKEN_THREAD, 4], [8172, 2]]),
  r(14930, "Quickdraw Quiver", [200, 220, 240], [8217, 1], [[THICK, 12], [8172, 1], [8949, 1], [SILKEN_THREAD, 4]]),
  r(14932, "Thick Leather Ammo Pouch", [200, 220, 240], [8218, 1], [[THICK, 10], [8172, 1], [8951, 1], [SILKEN_THREAD, 6]]),
  r(10548, "Nightscape Pants", [205, 225, 245], [8193, 1], [[THICK, 14], [SILKEN_THREAD, 4]]),
  r(10552, "Turtle Scale Helm", [205, 225, 245], [8191, 1], [[THICK, 14], [8167, 24], [HEAVY_SILKEN_THREAD, 1]]),
  r(19047, "Cured Rugged Hide", [225, 225, 235], [15407, 2], [[8171, 1], [15409, 1]]),
  r(19058, "Rugged Armor Kit", [225, 225, 245], [15564, 1], [[RUGGED, 5]]),
  r(10556, "Turtle Scale Leggings", [210, 230, 250], [8185, 1], [[THICK, 14], [8167, 28], [HEAVY_SILKEN_THREAD, 1]]),
  r(10558, "Nightscape Boots", [210, 230, 250], [8197, 1], [[THICK, 16], [HEAVY_SILKEN_THREAD, 2]]),
  r(10647, "Feathered Breastplate", [225, 245, 265], [8349, 1], [[THICK, 40], [8168, 40], [7971, 2], [8172, 4], [HEAVY_SILKEN_THREAD, 4]]),

  // Vendor patterns.
  r(19049, "Wicked Leather Gauntlets", [235, 255, 275], [15083, 1], [[RUGGED, 8], [BLACK_DYE, 1], [RUNE_THREAD, 1]], true),
  r(19082, "Runic Leather Headband", [265, 285, 305], [15094, 1], [[RUGGED, 14], [14047, 10], [RUNE_THREAD, 1]], true),
];

export const LEATHERWORKING: Profession = {
  id: "leatherworking",
  name: "Leatherworking",
  recipes: RECIPES,
  // Sold by trade vendors; prices from Wowhead.
  vendorPrices: {
    [COARSE_THREAD]: 10,
    [FINE_THREAD]: 100,
    [SILKEN_THREAD]: 500,
    [HEAVY_SILKEN_THREAD]: 2000,
    [RUNE_THREAD]: 5000,
    [BLACK_DYE]: 1000,
    [GREEN_DYE]: 100,
    [GRAY_DYE]: 350,
    [SALT]: 50,
  },
  itemNames: {
    783: "Light Hide",
    1529: "Jade",
    [LIGHT]: "Light Leather",
    [MEDIUM]: "Medium Leather",
    [COARSE_THREAD]: "Coarse Thread",
    [FINE_THREAD]: "Fine Thread",
    [BLACK_DYE]: "Black Dye",
    2457: "Elixir of Minor Agility",
    [GREEN_DYE]: "Green Dye",
    2934: "Ruined Leather Scraps",
    3182: "Spider's Silk",
    3389: "Elixir of Lesser Defense",
    3824: "Shadow Oil",
    3864: "Citrine",
    4231: "Cured Light Hide",
    4232: "Medium Hide",
    4233: "Cured Medium Hide",
    [HEAVY]: "Heavy Leather",
    4235: "Heavy Hide",
    4236: "Cured Heavy Hide",
    4246: "Fine Leather Belt",
    [SALT]: "Salt",
    [SILKEN_THREAD]: "Silken Thread",
    [THICK]: "Thick Leather",
    4305: "Bolt of Silk Cloth",
    [GRAY_DYE]: "Gray Dye",
    5116: "Long Tail Feather",
    5498: "Small Lustrous Pearl",
    5500: "Iridescent Pearl",
    5784: "Slimy Murloc Scale",
    7067: "Elemental Earth",
    7069: "Elemental Air",
    7070: "Elemental Water",
    7071: "Iron Buckle",
    7286: "Black Whelp Scale",
    7971: "Black Pearl",
    8146: "Wicked Claw",
    8167: "Turtle Scale",
    8168: "Jet Black Feather",
    [RUGGED]: "Rugged Leather",
    8171: "Rugged Hide",
    8172: "Cured Thick Hide",
    [HEAVY_SILKEN_THREAD]: "Heavy Silken Thread",
    8368: "Thick Wolfhide",
    8949: "Elixir of Agility",
    8951: "Elixir of Defense",
    14047: "Runecloth",
    [RUNE_THREAD]: "Rune Thread",
    15407: "Cured Rugged Hide",
    15409: "Refined Deeprock Salt",
  },
};
