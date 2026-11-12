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

// The real DataSource: Blizzard's (undocumented) WoW: Forever endpoints, EU.
//
// What it takes care of, so the collector doesn't have to:
//   * the access token: fetched once, reused until shortly before it expires
//   * retries: a network blip, a 429 or a 5xx is retried a few times with
//     growing waits, instead of losing the whole hour's snapshot
//   * validation: every response goes through its zod schema
//
// Checked against the live API on 12 Nov 2026:
//   * If-Modified-Since works: the house endpoint answers 304 with no body
//     when there's nothing newer, so a "nothing new" run downloads nothing.
//   * HEAD requests return 404, so we can't peek at Last-Modified cheaply.
//   * The namespace "static-forever-eu" resolves to the current versioned one
//     (e.g. static-1.60.1_70399-forever-eu), so no version is hard-coded.

const TOKEN_URL = "https://oauth.battle.net/token";
const API_ORIGIN = "https://eu.api.blizzard.com";
const DYNAMIC_NAMESPACE = "dynamic-forever-eu"; // auctions: changes hourly
const STATIC_NAMESPACE = "static-forever-eu"; // item names: changes with patches

const MAX_ATTEMPTS = 4; // 1 try + 3 retries
const FIRST_RETRY_DELAY_MS = 1_000; // then 2s, then 4s
const MAX_RETRY_DELAY_MS = 60_000;
const REQUEST_TIMEOUT_MS = 120_000; // a full house is a big download
const TOKEN_SAFETY_MARGIN_MS = 60_000; // stop using a token 1 min before it expires

// The two halves of a snapshot were 11 seconds apart when measured. If they
// are ever further apart than this, we caught Blizzard mid-update and the
// halves belong to different hours - better to fail and retry than to store it.
const MAX_HALVES_GAP_SECONDS = 15 * 60;

export interface ForeverSourceOptions {
  clientId: string;
  clientSecret: string;
  rulesetId: number;
  // The three below exist so tests can run without network or real waiting.
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
    // The trailing slash before `?` is required; without it Blizzard 404s.
    const url = `${API_ORIGIN}/data/wow/ruleset/${this.rulesetId}/auctions/?namespace=${DYNAMIC_NAMESPACE}`;
    const response = await this.authorizedGet(url);
    const index = await readJson(response, url, HousesIndexResponseSchema);
    return index.auctions.map((house) => ({ id: house.id, name: house.name.en_GB }));
  }

  async fetchSnapshot(houseId: number, since?: number): Promise<Snapshot | null> {
    const houseUrl = `${API_ORIGIN}/data/wow/ruleset/${this.rulesetId}/auctions/${houseId}?namespace=${DYNAMIC_NAMESPACE}`;

    // Ask Blizzard to send the house only if it changed since the snapshot we
    // already have. If not, the answer is "304 Not Modified" with no body.
    const conditional: Record<string, string> =
      since === undefined ? {} : { "If-Modified-Since": new Date(since * 1000).toUTCString() };
    const houseResponse = await this.authorizedGet(houseUrl, conditional);
    if (houseResponse.status === 304) return null;

    const takenAt = lastModifiedSeconds(houseResponse, houseUrl);
    // Belt and braces, in case Blizzard ever ignores If-Modified-Since.
    if (since !== undefined && takenAt <= since) {
      await houseResponse.body?.cancel();
      return null;
    }
    const house = await readJson(houseResponse, houseUrl, HouseResponseSchema);

    // Commodities come as a link. We follow it rather than build the URL, but
    // first make sure it points at Blizzard: our token goes out with the request.
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
    const url = `${API_ORIGIN}/data/wow/item/${itemId}?namespace=${STATIC_NAMESPACE}`;
    const response = await this.authorizedGet(url, {}, [404]);
    // 404 is a normal answer here: Blizzard has no data for many Forever items.
    if (response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    const item = await readJson(response, url, ItemResponseSchema);
    return {
      id: item.id,
      name: item.name.en_GB,
      ...(item.quality ? { quality: item.quality.type } : {}),
    };
  }

  // A GET with our access token. Returns the response when its status is 2xx,
  // 304, or one of `alsoAllow`; throws for anything else.
  private async authorizedGet(
    url: string,
    headers: Record<string, string> = {},
    alsoAllow: readonly number[] = [],
  ): Promise<Response> {
    let response = await this.fetchWithRetry(url, {
      headers: { ...headers, Authorization: `Bearer ${await this.getToken()}` },
    });

    // 401 means Blizzard no longer accepts the token (revoked or expired
    // early). Get a fresh one and try once more - only once, so wrong
    // credentials can't loop forever.
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

  // Returns the cached token, or fetches a new one when there is none or it's
  // about to expire. One token lasts about 24 hours.
  private async getToken(): Promise<string> {
    if (this.token && this.now() < this.token.expiresAt) {
      return this.token.value;
    }

    // OAuth "client credentials" flow: the app logs in as itself (no user),
    // sending its ID and secret as HTTP Basic auth.
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

  // fetch, but temporary problems are retried: a network error, 429 (rate
  // limited) or 5xx (Blizzard's side). Any other response is returned as-is
  // for the caller to judge - retrying a 404 or a 401 would never help.
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
      // Exponential backoff: 1s, 2s, 4s - unless Blizzard says how long to wait.
      const backoff = FIRST_RETRY_DELAY_MS * 2 ** (attempt - 1);
      await this.sleep(Math.min(retryAfterMs ?? backoff, MAX_RETRY_DELAY_MS));
    }
  }
}

// Reads a response body as JSON and checks it against a schema.
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

// When Blizzard produced this response, from its Last-Modified header, in
// Unix seconds. For auction data this is the moment the snapshot was taken.
function lastModifiedSeconds(response: Response, url: string): number {
  const header = response.headers.get("last-modified");
  const millis = header === null ? NaN : Date.parse(header);
  if (Number.isNaN(millis)) {
    throw new Error(`Missing or unreadable Last-Modified header (${header}) from ${url}`);
  }
  return Math.floor(millis / 1000);
}

// Retry-After as a number of seconds -> milliseconds; null if absent or odd.
function retryAfterHeaderMs(response: Response): number | null {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

function isoTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString();
}
