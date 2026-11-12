import type { CommodityListing } from "./types.js";

// Turns one snapshot's raw commodity listings (about 97,000 of them) into one
// small summary per item. The summaries are what we store; the raw listings
// are thrown away afterwards.
//
// These are pure functions: listings in, summaries out. No database, no
// network, no clock - which is what makes them easy to unit test.

// How many distinct prices to keep per item for the order book. 20 levels is
// plenty to answer "what does it cost to buy 300 of these?" for most items.
export const DEFAULT_MAX_LEVELS = 20;

// One step of the order book: every unit on sale at exactly this price.
export interface PriceLevel {
  unitPrice: number; // copper
  quantity: number; // summed across all listings at this price
}

// One item in one snapshot. Field names mirror the commodity_prices columns.
export interface CommoditySummary {
  itemId: number;
  minPrice: number; // cheapest unit price, in copper
  medianPrice: number; // quantity-weighted median unit price, in copper
  quantity: number; // total units listed
  qtyAtMin: number; // units available at minPrice
  listingCount: number; // separate listings (rough proxy for seller count)
  levels: PriceLevel[]; // cheapest first, at most maxLevels entries
}

// Summarises every item in a snapshot. Returns one entry per item ID, sorted
// by item ID so the output is the same on every run. An empty house gives [].
export function summarizeCommodities(
  listings: readonly CommodityListing[],
  maxLevels: number = DEFAULT_MAX_LEVELS,
): CommoditySummary[] {
  // A listing at 0 copper can't be bought for nothing in game, so it's bad
  // data. Dropping it here keeps min_price > 0, which the database insists on.
  const priced = listings.filter((listing) => listing.unit_price > 0);

  const byItem = new Map<number, CommodityListing[]>();
  for (const listing of priced) {
    const group = byItem.get(listing.item.id);
    if (group) {
      group.push(listing);
    } else {
      byItem.set(listing.item.id, [listing]);
    }
  }

  return [...byItem.entries()]
    .sort(([a], [b]) => a - b)
    .map(([itemId, group]) => summarizeItem(itemId, group, maxLevels));
}

// Summarises the listings of a single item. `group` must not be empty.
function summarizeItem(
  itemId: number,
  group: readonly CommodityListing[],
  maxLevels: number,
): CommoditySummary {
  // Merge listings with the same price into one level, then sort cheapest
  // first. Everything else below reads off this sorted order book.
  const qtyByPrice = new Map<number, number>();
  for (const listing of group) {
    qtyByPrice.set(listing.unit_price, (qtyByPrice.get(listing.unit_price) ?? 0) + listing.quantity);
  }
  const levels: PriceLevel[] = [...qtyByPrice.entries()]
    .map(([unitPrice, quantity]) => ({ unitPrice, quantity }))
    .sort((a, b) => a.unitPrice - b.unitPrice);

  const cheapest = levels[0];
  if (!cheapest) throw new Error(`No listings for item ${itemId}`);

  const quantity = levels.reduce((sum, level) => sum + level.quantity, 0);

  return {
    itemId,
    minPrice: cheapest.unitPrice,
    medianPrice: weightedMedian(levels, quantity),
    quantity,
    qtyAtMin: cheapest.quantity,
    listingCount: group.length,
    levels: levels.slice(0, maxLevels),
  };
}

// Quantity-weighted median: imagine every single unit laid out in a row,
// cheapest first, and take the price of the unit in the middle.
//
// Weighting by quantity matters because listings differ hugely in size: one
// listing of 1 Peacebloom should not count the same as one listing of 200.
//
// With an even number of units there are two middle units; we take the
// cheaper one (the "lower median") rather than averaging them, so the result
// is always a real price someone listed and always a whole number of copper.
//
// `levels` must be sorted cheapest first and `totalQuantity` must be their sum.
function weightedMedian(levels: readonly PriceLevel[], totalQuantity: number): number {
  const middleUnit = Math.ceil(totalQuantity / 2); // 1-based position in the row
  let unitsSeen = 0;
  for (const level of levels) {
    unitsSeen += level.quantity;
    if (unitsSeen >= middleUnit) return level.unitPrice;
  }
  throw new Error("weightedMedian: totalQuantity is larger than the levels' sum");
}
