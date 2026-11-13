import type { CommodityListing } from "./types.js";

// Turns a snapshot's raw commodity listings into one summary per item.
// Pure functions: no database, network or clock.

// Distinct prices kept per item for the order book.
export const DEFAULT_MAX_LEVELS = 20;

export interface PriceLevel {
  unitPrice: number; // copper
  quantity: number; // summed across all listings at this price
}

// Field names mirror the commodity_prices columns.
export interface CommoditySummary {
  itemId: number;
  minPrice: number; // cheapest unit price, in copper
  medianPrice: number; // quantity-weighted median unit price, in copper
  quantity: number; // total units listed
  qtyAtMin: number; // units available at minPrice
  listingCount: number; // separate listings (rough proxy for seller count)
  levels: PriceLevel[]; // cheapest first, at most maxLevels entries
}

// One entry per item ID, sorted by ID.
export function summarizeCommodities(
  listings: readonly CommodityListing[],
  maxLevels: number = DEFAULT_MAX_LEVELS,
): CommoditySummary[] {
  // A 0-copper listing is bad data, and the database requires min_price > 0.
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

function summarizeItem(
  itemId: number,
  group: readonly CommodityListing[],
  maxLevels: number,
): CommoditySummary {
  // Merge listings at the same price into one level, cheapest first.
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

// Quantity-weighted lower median: the price of the middle unit when every
// unit is laid out cheapest first. Always a real listed price in whole copper.
function weightedMedian(levels: readonly PriceLevel[], totalQuantity: number): number {
  const middleUnit = Math.ceil(totalQuantity / 2); // 1-based position in the row
  let unitsSeen = 0;
  for (const level of levels) {
    unitsSeen += level.quantity;
    if (unitsSeen >= middleUnit) return level.unitPrice;
  }
  throw new Error("weightedMedian: totalQuantity is larger than the levels' sum");
}
