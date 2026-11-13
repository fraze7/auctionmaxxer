// The 30 Waylaid Crates. A crate is filled with ANY ONE bundle from its list,
// then handed in for Merchant's Favor. Kept by hand from Wowhead's tooltips
// (13 Nov 2026) because Blizzard's API doesn't expose it.

export type CrateTier = "Apprentice" | "Journeyman" | "Expert" | "Artisan";

export interface CrateBundle {
  quantity: number;
  itemName: string;
}

export interface Crate {
  itemId: number; // the Waylaid Crate item itself, bought on the AH
  name: string; // without the "Waylaid Crate: " prefix
  tier: CrateTier;
  // Crafted crates (Fabrics, Ingots, Parts) pay double the favor of raw ones.
  crafted: boolean;
  bundles: CrateBundle[];
}

// Favor per hand-in. The Artisan figures are unconfirmed estimates.
const FAVOR: Record<CrateTier, { raw: number; crafted: number; estimated: boolean }> = {
  Apprentice: { raw: 5, crafted: 10, estimated: false },
  Journeyman: { raw: 10, crafted: 20, estimated: false },
  Expert: { raw: 15, crafted: 30, estimated: false },
  Artisan: { raw: 20, crafted: 40, estimated: true },
};

export function favorFor(crate: Pick<Crate, "tier" | "crafted">): { favor: number; estimated: boolean } {
  const row = FAVOR[crate.tier];
  return { favor: crate.crafted ? row.crafted : row.raw, estimated: row.estimated };
}

const b = (quantity: number, itemName: string): CrateBundle => ({ quantity, itemName });

export const CRATES: readonly Crate[] = [
  // --- Raw materials ---
  { itemId: 248682, name: "Apprentice Herbs", tier: "Apprentice", crafted: false,
    bundles: [b(20, "Peacebloom"), b(20, "Silverleaf"), b(10, "Earthroot"), b(10, "Mageroyal"), b(10, "Briarthorn")] },
  { itemId: 248683, name: "Apprentice Ore", tier: "Apprentice", crafted: false,
    bundles: [b(20, "Copper Ore"), b(20, "Tin Ore")] },
  { itemId: 248684, name: "Apprentice Textiles", tier: "Apprentice", crafted: false,
    bundles: [b(40, "Linen Cloth"), b(20, "Light Leather")] },
  { itemId: 248685, name: "Apprentice Curiosities", tier: "Apprentice", crafted: false,
    bundles: [b(20, "Strange Dust"), b(4, "Greater Magic Essence"), b(6, "Small Glimmering Shard"), b(2, "Large Glimmering Shard")] },

  { itemId: 248686, name: "Journeyman Herbs", tier: "Journeyman", crafted: false,
    bundles: [b(10, "Stranglekelp"), b(10, "Bruiseweed"), b(10, "Wild Steelbloom"), b(10, "Grave Moss"), b(10, "Kingsblood")] },
  { itemId: 248687, name: "Journeyman Ore", tier: "Journeyman", crafted: false,
    bundles: [b(10, "Silver Ore"), b(20, "Iron Ore")] },
  { itemId: 248688, name: "Journeyman Textiles", tier: "Journeyman", crafted: false,
    bundles: [b(20, "Wool Cloth"), b(40, "Silk Cloth"), b(20, "Medium Leather")] },
  { itemId: 248689, name: "Journeyman Curiosities", tier: "Journeyman", crafted: false,
    bundles: [b(20, "Soul Dust"), b(4, "Greater Astral Essence"), b(6, "Small Glowing Shard"), b(2, "Large Glowing Shard")] },

  { itemId: 248690, name: "Earthly Expert Herbs", tier: "Expert", crafted: false,
    bundles: [b(20, "Liferoot"), b(10, "Fadeleaf"), b(10, "Goldthorn"), b(10, "Khadgar's Whisker")] },
  { itemId: 248691, name: "Flowering Expert Herbs", tier: "Expert", crafted: false,
    bundles: [b(10, "Wintersbite"), b(10, "Firebloom"), b(20, "Purple Lotus"), b(10, "Arthas' Tears")] },
  { itemId: 248692, name: "Expert Ore", tier: "Expert", crafted: false,
    bundles: [b(10, "Gold Ore"), b(20, "Mithril Ore")] },
  { itemId: 248693, name: "Expert Textiles", tier: "Expert", crafted: false,
    bundles: [b(40, "Mageweave Cloth"), b(20, "Heavy Leather")] },
  { itemId: 248694, name: "Expert Curiosities", tier: "Expert", crafted: false,
    bundles: [b(20, "Vision Dust"), b(4, "Greater Mystic Essence"), b(6, "Small Radiant Shard"), b(2, "Large Radiant Shard")] },

  { itemId: 248695, name: "Earthly Artisan Herbs", tier: "Artisan", crafted: false,
    bundles: [b(10, "Golden Sansam"), b(20, "Sungrass"), b(10, "Blindweed"), b(10, "Ghost Mushroom"), b(10, "Gromsblood")] },
  { itemId: 248696, name: "Flowering Artisan Herbs", tier: "Artisan", crafted: false,
    bundles: [b(20, "Dreamfoil"), b(20, "Mountain Silversage"), b(20, "Plaguebloom"), b(20, "Icecap")] },
  { itemId: 248697, name: "Artisan Ore", tier: "Artisan", crafted: false,
    bundles: [b(10, "Truesilver Ore"), b(20, "Thorium Ore"), b(20, "Dark Iron Ore")] },
  { itemId: 248698, name: "Artisan Textiles", tier: "Artisan", crafted: false,
    bundles: [b(40, "Runecloth"), b(20, "Thick Leather"), b(20, "Rugged Leather")] },
  { itemId: 248699, name: "Artisan Curiosities", tier: "Artisan", crafted: false,
    bundles: [b(20, "Dream Dust"), b(4, "Greater Nether Essence"), b(6, "Small Brilliant Shard"), b(2, "Large Brilliant Shard")] },

  // --- Crafted materials (double favor) ---
  { itemId: 248702, name: "Apprentice Fabrics", tier: "Apprentice", crafted: true,
    bundles: [b(2, "Cured Light Hide"), b(20, "Bolt of Linen Cloth")] },
  { itemId: 248703, name: "Apprentice Ingots", tier: "Apprentice", crafted: true,
    bundles: [b(20, "Copper Bar"), b(20, "Tin Bar"), b(10, "Bronze Bar")] },
  { itemId: 248704, name: "Apprentice Parts", tier: "Apprentice", crafted: true,
    bundles: [b(16, "Handful of Copper Bolts"), b(16, "Copper Tube"), b(4, "Copper Modulator")] },

  { itemId: 248705, name: "Journeyman Fabrics", tier: "Journeyman", crafted: true,
    bundles: [b(6, "Bolt of Woolen Cloth"), b(10, "Bolt of Silk Cloth"), b(2, "Cured Medium Hide")] },
  { itemId: 248706, name: "Journeyman Ingots", tier: "Journeyman", crafted: true,
    bundles: [b(10, "Silver Bar"), b(20, "Iron Bar")] },
  { itemId: 248707, name: "Journeyman Parts", tier: "Journeyman", crafted: true,
    bundles: [b(8, "Bronze Tube"), b(7, "Whirring Bronze Gizmo"), b(4, "Bronze Framework"), b(45, "Gold Power Core")] },

  { itemId: 248708, name: "Expert Fabrics", tier: "Expert", crafted: true,
    bundles: [b(8, "Bolt of Mageweave"), b(2, "Cured Heavy Hide")] },
  { itemId: 248709, name: "Expert Ingots", tier: "Expert", crafted: true,
    bundles: [b(20, "Mithril Bar"), b(15, "Steel Bar"), b(10, "Gold Bar")] },
  { itemId: 248710, name: "Expert Parts", tier: "Expert", crafted: true,
    bundles: [b(8, "Iron Strut"), b(5, "Mithril Tube"), b(12, "Unstable Trigger"), b(5, "Mithril Casing")] },

  { itemId: 248711, name: "Artisan Fabrics", tier: "Artisan", crafted: true,
    bundles: [b(8, "Bolt of Runecloth"), b(2, "Cured Thick Hide")] },
  { itemId: 248712, name: "Artisan Ingots", tier: "Artisan", crafted: true,
    bundles: [b(2, "Dark Iron Bar"), b(10, "Truesilver Bar"), b(20, "Thorium Bar")] },
  { itemId: 248713, name: "Artisan Parts", tier: "Artisan", crafted: true,
    bundles: [b(5, "Thorium Widget"), b(5, "Truesilver Transformer"), b(2, "Thorium Tube")] },
];
