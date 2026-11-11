import { z } from "zod";

// ---------------------------------------------------------------------------
// Why zod schemas instead of plain interfaces?
// Blizzard's Forever API is undocumented, so we can't trust its shape. Each
// schema below does two jobs: it checks every response at runtime (parse fails
// loudly if Blizzard changes something), and `z.infer` turns it into the
// TypeScript type, so the check and the type can never drift apart.
//
// Field names stay in Blizzard's snake_case (unit_price, time_left) so the
// schemas match the JSON exactly. Our own types further down use camelCase.
//
// Shapes are based on a survey of house 113's snapshot on 9 Nov 2026:
// 170,238 item listings and 96,640 commodity listings.
// ---------------------------------------------------------------------------

// Every value seen in that snapshot. An unknown value fails validation,
// which is what we want: better to stop than to store data we don't understand.
export const TimeLeftSchema = z.enum(["SHORT", "MEDIUM", "LONG", "VERY_LONG"]);
export type TimeLeft = z.infer<typeof TimeLeftSchema>;

// Prices are integers in copper (1g = 10,000c). Never floats: rounding bugs.
const copper = z.number().int().nonnegative();
const id = z.number().int().positive();

// --- Commodities: herbs, ore, cloth, reagents (what v1 tracks) -------------

// Commodity listings only ever had `item.id` - no variants.
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

// --- Item listings: gear and other non-stackables (ignored in v1) ----------

// Seen as { "type": 28, "value": 5256 }. What the numbers mean is unknown.
export const ItemModifierSchema = z.object({
  type: z.number().int(),
  value: z.number().int(),
});

// `id` is always present. The rest appear on some listings only:
// bonus_lists on 29,786, context on 26,410, modifiers on 20,507.
// bonus_lists most likely marks variants ("of the Bear" vs "of the Eagle"),
// which is why gear needs grouping by id + bonus_lists before we track it.
export const ItemRefSchema = z.object({
  id,
  bonus_lists: z.array(z.number().int()).optional(),
  context: z.number().int().optional(),
  modifiers: z.array(ItemModifierSchema).optional(),
});
export type ItemRef = z.infer<typeof ItemRefSchema>;

// Every item listing had quantity 1, so `buyout` is the price of one item.
// buyout was missing on 6 listings (bid-only auctions); bid appeared on 475.
export const ItemListingSchema = z.object({
  id,
  item: ItemRefSchema,
  quantity: z.number().int().positive(),
  buyout: copper.optional(),
  bid: copper.optional(),
  time_left: TimeLeftSchema,
});
export type ItemListing = z.infer<typeof ItemListingSchema>;

// The house endpoint returns item listings inline, but commodities only as a
// link. We follow `commodities.href` rather than building that URL ourselves.
export const HouseResponseSchema = z.object({
  id,
  auctions: z.array(ItemListingSchema),
  commodities: z.object({ href: z.string() }),
});

// --- Our own types (not Blizzard's JSON) -----------------------------------

export interface House {
  id: number;
  // One name only (en_GB). The API sends every language; we don't need them.
  name: string;
}

export interface Snapshot {
  houseId: number;
  // When Blizzard took the snapshot, from the Last-Modified header, in Unix
  // seconds (UTC). A plain integer is the easiest thing to store in SQLite,
  // sort and compare - and it's never the time our script happened to run.
  takenAt: number;
  commodities: CommodityListing[];
  items: ItemListing[];
}

export interface ItemInfo {
  id: number;
  name: string;
  quality?: string; // e.g. "UNCOMMON"; optional until we know Forever sends it
}
