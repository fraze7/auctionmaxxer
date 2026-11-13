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

// A DataSource that reads saved files instead of calling Blizzard.
// Defaults to server/test-fixtures; pass a folder holding house-113.json and
// commodities-113.json to use full snapshots.

const HOUSE_ID = 113;

// The saved snapshot's Last-Modified time.
const TAKEN_AT = Date.parse("2026-11-09T16:12:19Z") / 1000;

// Every other ID returns null, like an item Blizzard has no data for.
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
    if (since !== undefined && since >= TAKEN_AT) {
      return null;
    }

    // Same schemas as live data, so the mock can't return what the real source wouldn't.
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
