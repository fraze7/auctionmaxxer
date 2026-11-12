import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { DataSource } from "./dataSource.js";
import {
  CommoditiesResponseSchema,
  HouseResponseSchema,
  type House,
  type ItemInfo,
  type Snapshot,
} from "./types.js";

// A fake DataSource that reads saved files instead of calling Blizzard.
// Use it to develop and test without credentials or network, and to get the
// same answer every time (the real API changes every hour).
//
// By default it reads the small samples in server/test-fixtures. Pass another
// folder to use the full snapshots, e.g. new MockSource("fixtures/utf8").
// Either folder must contain house-113.json and commodities-113.json.

const HOUSE_ID = 113;

// When the saved snapshot was taken (its Last-Modified time), in Unix seconds.
const TAKEN_AT = Date.parse("2026-11-09T16:12:19Z") / 1000;

// A couple of known names, so the "item found" path can be tested.
// Every other ID returns null, like a Forever item Blizzard has no data for.
const KNOWN_ITEMS: ReadonlyMap<number, ItemInfo> = new Map([
  [2447, { id: 2447, name: "Peacebloom", quality: "COMMON" }],
  [2589, { id: 2589, name: "Linen Cloth", quality: "COMMON" }],
]);

const DEFAULT_DIR = fileURLToPath(new URL("../test-fixtures/", import.meta.url));

export class MockSource implements DataSource {
  constructor(private readonly dir: string = DEFAULT_DIR) {}

  async listHouses(): Promise<House[]> {
    return [{ id: HOUSE_ID, name: "Horde Auction House" }];
  }

  async fetchSnapshot(houseId: number, since?: number): Promise<Snapshot | null> {
    if (houseId !== HOUSE_ID) {
      throw new Error(`MockSource only has data for house ${HOUSE_ID}, not ${houseId}`);
    }
    // Same rule the real source follows: nothing newer than `since` -> null.
    if (since !== undefined && since >= TAKEN_AT) {
      return null;
    }

    // Run the files through the same schemas as live data, so the mock can
    // never hand the collector something the real source would reject.
    const house = HouseResponseSchema.parse(await this.readJson("house-113.json"));
    const commodities = CommoditiesResponseSchema.parse(
      await this.readJson("commodities-113.json"),
    );

    return {
      houseId,
      takenAt: TAKEN_AT,
      commodities: commodities.auctions,
      items: house.auctions,
    };
  }

  async getItem(itemId: number): Promise<ItemInfo | null> {
    return KNOWN_ITEMS.get(itemId) ?? null;
  }

  private async readJson(fileName: string): Promise<unknown> {
    const text = await readFile(`${this.dir}/${fileName}`, "utf8");
    return JSON.parse(text);
  }
}
