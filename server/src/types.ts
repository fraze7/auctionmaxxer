import { z } from "zod";

// Zod schemas for Blizzard's undocumented API: each validates responses at
// runtime and gives the TypeScript type via z.infer. Fields keep Blizzard's
// snake_case; our own types below use camelCase.
// Shapes are based on house 113's snapshot of 9 Nov 2026.

// Unknown values fail validation on purpose.
export const TimeLeftSchema = z.enum(["SHORT", "MEDIUM", "LONG", "VERY_LONG"]);
export type TimeLeft = z.infer<typeof TimeLeftSchema>;

// Integer copper (1g = 10,000c), never floats.
const copper = z.number().int().nonnegative();
const id = z.number().int().positive();

// --- Commodities (what v1 tracks) ---

export const CommodityListingSchema = z.object({
  id,
  item: z.object({ id }),
  quantity: z.number().int().positive(),
  unit_price: copper, // price per single unit, not per listing
  time_left: TimeLeftSchema,
});
export type CommodityListing = z.infer<typeof CommodityListingSchema>;

export const CommoditiesResponseSchema = z.object({
  auctions: z.array(CommodityListingSchema),
});

// --- Item listings: gear (ignored in v1) ---

// Seen as { type: 28, value: 5256 }; meaning unknown.
export const ItemModifierSchema = z.object({
  type: z.number().int(),
  value: z.number().int(),
});

// Only `id` is always present. bonus_lists probably marks variants, so gear
// needs grouping by id + bonus_lists before it can be tracked.
export const ItemRefSchema = z.object({
  id,
  bonus_lists: z.array(z.number().int()).optional(),
  context: z.number().int().optional(),
  modifiers: z.array(ItemModifierSchema).optional(),
});
export type ItemRef = z.infer<typeof ItemRefSchema>;

// Quantity is always 1. buyout is missing on bid-only auctions.
export const ItemListingSchema = z.object({
  id,
  item: ItemRefSchema,
  quantity: z.number().int().positive(),
  buyout: copper.optional(),
  bid: copper.optional(),
  time_left: TimeLeftSchema,
});
export type ItemListing = z.infer<typeof ItemListingSchema>;

// Item listings come inline; commodities only as a link.
export const HouseResponseSchema = z.object({
  id,
  auctions: z.array(ItemListingSchema),
  commodities: z.object({ href: z.string() }),
});

// --- Our own types ---

export interface House {
  id: number;
  // en_GB only.
  name: string;
}

export interface Snapshot {
  houseId: number;
  // From Last-Modified, Unix seconds UTC. Never the time our script ran.
  takenAt: number;
  commodities: CommodityListing[];
  items: ItemListing[];
}

export interface ItemInfo {
  id: number;
  name: string;
  quality?: string; // e.g. "UNCOMMON"; optional until we know Forever sends it
  sellPrice?: number; // copper a vendor pays for one
}

// --- Other Blizzard responses ---

// Names arrive in every language; we read en_GB only.
const LocalizedNameSchema = z.object({ en_GB: z.string() });

// GET /data/wow/ruleset/{id}/auctions/
export const HousesIndexResponseSchema = z.object({
  auctions: z.array(z.object({ id, name: LocalizedNameSchema })),
});

// GET /data/wow/item/{id}
export const ItemResponseSchema = z.object({
  id,
  name: LocalizedNameSchema,
  quality: z.object({ type: z.string() }).optional(),
  sell_price: z.number().int().nonnegative().optional(),
});

// POST https://oauth.battle.net/token. expires_in is in seconds.
export const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
});
