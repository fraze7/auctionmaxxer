import type { z } from "zod";
import type { DataSource } from "./dataSource.js";
import {
  CommoditiesResponseSchema,
  HouseResponseSchema,
  HousesIndexResponseSchema,
  ItemResponseSchema,
  TokenResponseSchema,
  type House,
  type ItemInfo,
  type Snapshot,
} from "./types.js";

// The real DataSource: Blizzard's undocumented WoW: Forever endpoints (EU).
// Handles the access token, retries and response validation.
// Checked live on 12 Nov 2026: If-Modified-Since gives 304; HEAD gives 404;
// the "static-forever-eu" namespace resolves to the current version.

const TOKEN_URL = "https://oauth.battle.net/token";
const API_ORIGIN = "https://eu.api.blizzard.com";
const DYNAMIC_NAMESPACE = "dynamic-forever-eu"; // auctions: changes hourly
const STATIC_NAMESPACE = "static-forever-eu"; // item names: changes with patches
// Classic Era's catalogue: it has some Classic items Forever's lacks, such as
// Rockshard Pellets (checked 17 Nov 2026).
const FALLBACK_NAMESPACE = "static-classic1x-eu";

const MAX_ATTEMPTS = 4; // 1 try + 3 retries
const FIRST_RETRY_DELAY_MS = 1_000; // then 2s, then 4s
const MAX_RETRY_DELAY_MS = 60_000;
const REQUEST_TIMEOUT_MS = 120_000; // a full house is a big download
const TOKEN_SAFETY_MARGIN_MS = 60_000; // stop using a token 1 min before it expires

// Halves further apart than this belong to different hours: fail and retry.
const MAX_HALVES_GAP_SECONDS = 15 * 60;

export interface ForeverSourceOptions {
  clientId: string;
  clientSecret: string;
  rulesetId: number;
  // Injectable for tests.
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number; // milliseconds, like Date.now()
}

interface CachedToken {
  value: string;
  expiresAt: number; // milliseconds, like Date.now()
}

export class ForeverSource implements DataSource {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly rulesetId: number;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private token: CachedToken | null = null;

  constructor(options: ForeverSourceOptions) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.rulesetId = options.rulesetId;
    this.fetchFn = options.fetch ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? Date.now;
  }

  async listHouses(): Promise<House[]> {
    // The trailing slash before `?` is required.
    const url = `${API_ORIGIN}/data/wow/ruleset/${this.rulesetId}/auctions/?namespace=${DYNAMIC_NAMESPACE}`;
    const response = await this.authorizedGet(url);
    const index = await readJson(response, url, HousesIndexResponseSchema);
    return index.auctions.map((house) => ({ id: house.id, name: house.name.en_GB }));
  }

  async fetchSnapshot(houseId: number, since?: number): Promise<Snapshot | null> {
    const houseUrl = `${API_ORIGIN}/data/wow/ruleset/${this.rulesetId}/auctions/${houseId}?namespace=${DYNAMIC_NAMESPACE}`;

    // Unchanged since our last snapshot -> 304 with no body.
    const conditional: Record<string, string> =
      since === undefined ? {} : { "If-Modified-Since": new Date(since * 1000).toUTCString() };
    const houseResponse = await this.authorizedGet(houseUrl, conditional);
    if (houseResponse.status === 304) return null;

    const takenAt = lastModifiedSeconds(houseResponse, houseUrl);
    // In case Blizzard ever ignores If-Modified-Since.
    if (since !== undefined && takenAt <= since) {
      await houseResponse.body?.cancel();
      return null;
    }
    const house = await readJson(houseResponse, houseUrl, HouseResponseSchema);

    // Our token goes out with this request, so the link must point at Blizzard.
    const commoditiesUrl = house.commodities.href;
    if (new URL(commoditiesUrl).origin !== API_ORIGIN) {
      throw new Error(`Refusing to follow commodities link to another host: ${commoditiesUrl}`);
    }
    const commoditiesResponse = await this.authorizedGet(commoditiesUrl);
    const commoditiesTakenAt = lastModifiedSeconds(commoditiesResponse, commoditiesUrl);
    if (Math.abs(commoditiesTakenAt - takenAt) > MAX_HALVES_GAP_SECONDS) {
      await commoditiesResponse.body?.cancel();
      throw new Error(
        `Items and commodities are from different snapshots ` +
          `(${isoTime(takenAt)} vs ${isoTime(commoditiesTakenAt)}); try again later`,
      );
    }
    const commodities = await readJson(commoditiesResponse, commoditiesUrl, CommoditiesResponseSchema);

    return { houseId, takenAt, commodities: commodities.auctions, items: house.auctions };
  }

  async getItem(itemId: number): Promise<ItemInfo | null> {
    for (const namespace of [STATIC_NAMESPACE, FALLBACK_NAMESPACE]) {
      const url = `${API_ORIGIN}/data/wow/item/${itemId}?namespace=${namespace}`;
      const response = await this.authorizedGet(url, {}, [404]);
      // 404 is normal: Blizzard has no data for many Forever items.
      if (response.status === 404) {
        await response.body?.cancel();
        continue;
      }
      const item = await readJson(response, url, ItemResponseSchema);
      return {
        id: item.id,
        name: item.name.en_GB,
        ...(item.quality ? { quality: item.quality.type } : {}),
        ...(item.sell_price !== undefined ? { sellPrice: item.sell_price } : {}),
      };
    }
    return null;
  }

  // Returns 2xx, 304 or `alsoAllow` responses; throws for anything else.
  private async authorizedGet(
    url: string,
    headers: Record<string, string> = {},
    alsoAllow: readonly number[] = [],
  ): Promise<Response> {
    let response = await this.fetchWithRetry(url, {
      headers: { ...headers, Authorization: `Bearer ${await this.getToken()}` },
    });

    // Token rejected: refresh and retry once only.
    if (response.status === 401) {
      await response.body?.cancel();
      this.token = null;
      response = await this.fetchWithRetry(url, {
        headers: { ...headers, Authorization: `Bearer ${await this.getToken()}` },
      });
    }

    if (response.ok || response.status === 304 || alsoAllow.includes(response.status)) {
      return response;
    }
    await response.body?.cancel();
    throw new Error(`Blizzard answered HTTP ${response.status} for ${url}`);
  }

  // Cached until shortly before expiry (about 24 hours).
  private async getToken(): Promise<string> {
    if (this.token && this.now() < this.token.expiresAt) {
      return this.token.value;
    }

    // OAuth client-credentials: ID and secret as HTTP Basic auth.
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
    const response = await this.fetchWithRetry(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `Could not get an access token (HTTP ${response.status}). ` +
          `Check BLIZZARD_CLIENT_ID and BLIZZARD_CLIENT_SECRET in .env`,
      );
    }
    const token = await readJson(response, TOKEN_URL, TokenResponseSchema);
    this.token = {
      value: token.access_token,
      expiresAt: this.now() + token.expires_in * 1000 - TOKEN_SAFETY_MARGIN_MS,
    };
    return this.token.value;
  }

  // Retries network errors, 429 and 5xx. Other responses go back to the caller.
  private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    for (let attempt = 1; ; attempt++) {
      let problem: string;
      let retryAfterMs: number | null = null;
      try {
        const response = await this.fetchFn(url, {
          ...init,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (response.status !== 429 && response.status < 500) return response;
        problem = `HTTP ${response.status}`;
        retryAfterMs = retryAfterHeaderMs(response);
        await response.body?.cancel();
      } catch (err) {
        problem = err instanceof Error ? err.message : String(err);
      }

      if (attempt >= MAX_ATTEMPTS) {
        throw new Error(`Gave up on ${url} after ${attempt} attempts: ${problem}`);
      }
      // Backoff 1s, 2s, 4s, unless Retry-After says otherwise.
      const backoff = FIRST_RETRY_DELAY_MS * 2 ** (attempt - 1);
      await this.sleep(Math.min(retryAfterMs ?? backoff, MAX_RETRY_DELAY_MS));
    }
  }
}

async function readJson<S extends z.ZodType>(
  response: Response,
  url: string,
  schema: S,
): Promise<z.infer<S>> {
  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    throw new Error(`Response from ${url} was not valid JSON`, { cause: err });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new Error(`Unexpected response shape from ${url}: ${parsed.error.message}`);
  }
  return parsed.data;
}

// Last-Modified in Unix seconds: when the snapshot was taken.
function lastModifiedSeconds(response: Response, url: string): number {
  const header = response.headers.get("last-modified");
  const millis = header === null ? NaN : Date.parse(header);
  if (Number.isNaN(millis)) {
    throw new Error(`Missing or unreadable Last-Modified header (${header}) from ${url}`);
  }
  return Math.floor(millis / 1000);
}

// Retry-After in milliseconds, or null.
function retryAfterHeaderMs(response: Response): number | null {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

function isoTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString();
}
