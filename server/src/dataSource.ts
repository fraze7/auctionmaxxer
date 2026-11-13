import type { House, ItemInfo, Snapshot } from "./types.js";

// Implemented by MockSource (saved files) and ForeverSource (Blizzard).
// Chosen by DATA_SOURCE in .env; the collector never knows which.
export interface DataSource {
  listHouses(): Promise<House[]>;

  // The latest snapshot, or null when it is not newer than `since` (Unix seconds).
  fetchSnapshot(houseId: number, since?: number): Promise<Snapshot | null>;

  // null when Blizzard has no data for the item, which is common and not an error.
  getItem(itemId: number): Promise<ItemInfo | null>;
}
