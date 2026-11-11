import type { House, ItemInfo, Snapshot } from "./types.js";

// One interface, several implementations:
//   MockSource    - reads files from test-fixtures/ (no network, no credentials)
//   ForeverSource - the real Blizzard endpoints
//   RetailSource  - optional fallback if the Forever endpoints break
// The collector picks one from DATA_SOURCE in .env and never knows which.
//
// Every method returns a Promise because the real source makes network calls.
// MockSource reads files, but keeping the same signature lets them swap freely.
export interface DataSource {
  // Auction houses for the configured ruleset.
  listHouses(): Promise<House[]>;

  // The latest snapshot for one house.
  // Pass `since` (Unix seconds) to get `null` back when Blizzard's snapshot is
  // not newer than that - so the collector skips a snapshot it already stored
  // instead of saving the same hour twice.
  fetchSnapshot(houseId: number, since?: number): Promise<Snapshot | null>;

  // Name and quality for one item, or `null` when Blizzard has no data for it.
  // Not an error: many Forever item IDs are reported to 404, so this is a
  // normal, expected answer. The UI shows "Unknown item #12345" instead.
  getItem(itemId: number): Promise<ItemInfo | null>;
}
