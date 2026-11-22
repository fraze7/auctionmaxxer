// Response shapes and one function per endpoint. Components never call fetch()
// themselves. Prices are whole copper and times are Unix seconds.

export interface Price {
  minPrice: number
  medianPrice: number
  quantity: number
  qtyAtMin: number | null // null = sold one at a time
  listingCount: number
}

export interface Status {
  house: number
  now: number
  lastSnapshot: { takenAt: number; fetchedAt: number; listingCount: number; ageSeconds: number } | null
  stale: boolean
  last24h: { ok: number; empty: number; failed: number }
  lastFailure: { fetchedAt: number; error: string } | null
  items: { named: number; pending: number; missing: number }
}

export interface ItemSummary {
  id: number
  name: string | null // null = Blizzard has no name for it (yet)
  quality: string | null
  price: Price | null // null = not on sale in the latest snapshot
}

export interface ItemSearch {
  house: number
  takenAt: number | null
  total: number
  limit: number
  offset: number
  items: ItemSummary[]
}

export type Trend = 'falling' | 'stable' | 'rising'

export interface Deal {
  id: number
  name: string | null
  quality: string | null
  minPrice: number
  qtyAtMin: number
  snapshots: number
  buyQty: number
  totalProfit: number
  soldPerDay: number | null // estimate; null = too little history
  recentMedian: number
  weekMedian: number
  trendRatio: number
  trend: Trend
  expectedSale: number
  profitPerUnit: number
  isDeal: boolean
}

export interface DealsResponse {
  house: number
  minProfit: number
  takenAt: number | null
  history: { snapshots: number; needed: number; ready: boolean; itemsJudged: number }
  deals: Deal[]
}

export interface Settings {
  ahCut: number
  dealMinSnapshots: number
  dealTrendFalling: number
  dealTrendRising: number
  dealMaxPriceRatio: number
  dealMinProfit: number
  dealMaxStockRatio: number
}

// The server couldn't be reached at all, as opposed to answering with an error.
export class ApiUnreachableError extends Error {}

type Params = Record<string, string | number | undefined>

async function get<T>(path: string, params: Params = {}): Promise<T> {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value))
  }
  const url = query.size > 0 ? `${path}?${query}` : path

  let response: Response
  try {
    response = await fetch(url)
  } catch {
    throw new ApiUnreachableError('Could not reach the API')
  }

  // Vite's proxy answers 500/502 itself when the tunnel is down.
  const isJson = response.headers.get('content-type')?.includes('application/json')
  if (!isJson) throw new ApiUnreachableError('Could not reach the API')

  const body = await response.json()
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`)
  return body as T
}

export const api = {
  status: () => get<Status>('/api/status'),
  settings: () => get<Settings>('/api/settings'),
  items: (params: { q?: string; limit?: number; offset?: number }) => get<ItemSearch>('/api/items', params),
  deals: (params: { show?: string; minProfit?: number; maxQty?: number }) => get<DealsResponse>('/api/deals', params),
}

// --- One item ---

export interface PriceLevel {
  unitPrice: number
  quantity: number
}

export interface ItemTrend {
  recentMedian: number
  weekMedian: number
  trendRatio: number
  trend: Trend
  expectedSale: number
  profitPerUnit: number
  isDeal: boolean
  snapshots: number
}

export interface ItemDetail {
  id: number
  name: string | null
  quality: string | null
  nameStatus: 'ok' | 'pending' | 'missing'
  kind: 'commodity' | 'single' // single = sold one at a time, such as a recipe
  house: number
  takenAt: number | null
  price: Price | null
  trend: ItemTrend | null // null = too little history, or not on sale now
  levels: PriceLevel[] // cheapest first
}

export interface HistoryPoint {
  takenAt: number
  minPrice: number
  medianPrice: number
  quantity: number
  qtyAtMin: number
  listingCount: number
}

export interface ItemHistory {
  id: number
  house: number
  days: number
  points: HistoryPoint[] // oldest first
}

export interface HourOfDay {
  hour: number // 0-23, UTC
  ratio: number | null // price / the day's typical price; null = too few samples
  samples: number
}

export interface HourlyPattern {
  id: number
  days: number // span of history used
  ready: boolean
  repeats: boolean // the cheap and dear hours are the same on odd and even days
  hours: HourOfDay[]
}

export const itemApi = {
  hours: (id: number) => get<HourlyPattern>(`/api/items/${id}/hours`),
  detail: (id: number) => get<ItemDetail>(`/api/items/${id}`),
  history: (id: number, days: number) => get<ItemHistory>(`/api/items/${id}/history`, { days }),
}

// --- Merchant's Favor ---

export interface FavorBundle {
  itemId: number | null // null = an item we've never seen, so it has no price
  itemName: string
  quantity: number
  cost: number | null // copper for the whole bundle; null = can't buy that many
  listed: number
}

export interface FavorCrate {
  itemId: number
  name: string
  tier: 'Apprentice' | 'Journeyman' | 'Expert' | 'Artisan'
  crafted: boolean
  favor: number
  favorEstimated: boolean
  cratePrice: number | null
  cratesListed: number
  bundles: FavorBundle[]
  best: {
    bundleIndex: number
    crateCost: number
    materialsCost: number
    totalCost: number
    copperPerFavor: number
  } | null
}

export interface FavorPlanStep {
  crateId: number
  crateName: string
  favorEach: number
  favorEstimated: boolean
  bundleItemId: number
  bundleItemName: string
  bundleQuantity: number
  count: number
  crateCost: number
  materialsCost: number
}

export interface FavorResponse {
  house: number
  takenAt: number | null
  crates: FavorCrate[] // cheapest per favor first
  plan: {
    target: number
    favor: number
    totalCost: number
    complete: boolean
    steps: FavorPlanStep[]
  }
  // The crates' cheapest and dearest four hours over the last week; null when not consistent.
  crateHours: { cheapest: HourStretch | null; dearest: HourStretch | null }
}

export interface HourStretch {
  from: number // UTC hour
  to: number
  ratio: number // price / the day's typical price
}

export const favorApi = {
  get: (target: number) => get<FavorResponse>('/api/favor', { target }),
}

// --- Watchlist ---

export type Direction = 'below' | 'above'

export interface Watch {
  id: number
  itemId: number
  name: string | null
  quality: string | null
  direction: Direction
  threshold: number // copper per unit
  createdAt: number
  triggeredAt: number | null // null = the price isn't past the threshold right now
  currentMin: number | null // null = not listed in the latest snapshot
}

export interface WatchAlert {
  id: number
  itemId: number
  name: string | null
  quality: string | null
  direction: Direction
  threshold: number
  price: number
  takenAt: number
  notifiedAt: number | null // null = not sent to Discord (yet)
}

export interface Watchlist {
  house: number
  takenAt: number | null
  discordConfigured: boolean
  watches: Watch[]
  alerts: WatchAlert[]
  tabRules: TabRule[]
  tabAlerts: TabAlert[]
}

export type TabKind = 'deal' | 'reset' | 'vendor' | 'craft'

// Alerts are on for a tab when it has a rule.
export interface TabRule {
  kind: TabKind
  minProfit: number
}

export interface TabAlert {
  id: number
  kind: TabKind
  itemId: number
  name: string | null
  quality: string | null
  profit: number
  takenAt: number
  notifiedAt: number | null
}

// For requests that change something. The server only accepts JSON bodies.
async function send<T>(method: 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      method,
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    })
  } catch {
    throw new ApiUnreachableError('Could not reach the API')
  }
  if (response.status === 204) return undefined as T // "done, nothing to send back"

  const isJson = response.headers.get('content-type')?.includes('application/json')
  if (!isJson) throw new ApiUnreachableError('Could not reach the API')
  const result = await response.json()
  if (!response.ok) throw new Error(result.error ?? `Request failed (${response.status})`)
  return result as T
}

export const watchApi = {
  list: () => get<Watchlist>('/api/watchlist'),
  save: (rule: { itemId: number; direction: Direction; threshold: number }) =>
    send<Watch>('POST', '/api/watchlist', rule),
  remove: (id: number) => send<void>('DELETE', `/api/watchlist/${id}`),
}

export const tabAlertApi = {
  save: (rule: TabRule) => send<TabRule>('POST', '/api/tab-alerts', rule),
  remove: (kind: TabKind) => send<void>('DELETE', `/api/tab-alerts/${kind}`),
}

// --- Profession levelling ---

export interface LevelMaterial {
  itemId: number
  name: string
  quantity: number
  crafted: number // of `quantity`, how many an earlier step made
  cost: number
  vendor: boolean
  estimated: boolean // priced partly beyond the stored order book
  // Bought to craft this reagent. `saves` is against buying the reagent itself; null = too little on sale.
  via?: { name: string; quantity: number; saves: number | null }
}

export interface LevelStep {
  from: number
  to: number
  spellId: number
  recipeName: string
  crafts: number
  guaranteed: boolean
  plan: boolean // needs a bought plan, not a trainer
  materials: LevelMaterial[]
  cost: number
  sells: number // what a vendor pays for what the step makes
  stops: Array<{ skill: number; cost: number }> // the step's cost if it ended early at `skill`
  // The plan's item on the auction house; null = never seen there. price null = none listed now.
  planItem: { itemId: number; price: number | null; listed: number; seen: boolean } | null
}

export interface LevellingResponse {
  house: number
  takenAt: number | null
  profession: { id: string; name: string }
  professions: Array<{ id: string; name: string }>
  helper: { id: string; name: string; skill: number } | null // a second profession that can make reagents
  skipped: Array<{ spellId: number; name: string }> // plans left out on request
  unavailable: Array<{ spellId: number; name: string }> // dropped plans nobody has listed
  from: number
  to: number
  reached: number
  complete: boolean
  tooDear: boolean // stopped on price, not for lack of materials
  totalCost: number
  totalSells: number // selling what the route makes to a vendor
  brackets: Array<{ from: number; to: number; cost: number; complete: boolean }>
  steps: LevelStep[]
  shopping: LevelMaterial[]
}

export const levellingApi = {
  get: (params: { profession?: string; from?: number; to?: number; helperSkill?: number; skip?: string }) =>
    get<LevellingResponse>('/api/levelling', params),
}

// --- Crafts ---

export interface Craft {
  kind: 'stack' | 'gear' // gear is sold one at a time
  profession: { id: string; name: string }
  spellId: number
  name: string
  skill: number
  plan: boolean
  productId: number
  productName: string
  makes: number
  materials: Array<{
    itemId: number
    name: string
    quantity: number
    unitCost: number
    source: 'vendor' | 'auction' | 'crafted'
  }>
  cost: number
  sale: number // one craft, after the AH cut
  saleTo: 'auction' | 'vendor'
  profit: number
  listed: number
  count: number // crafts the totals are for
  totalCost: number
  totalProfit: number
  limited: boolean // fewer than asked for: materials are not all on sale
  heldBy: 'materials' | 'sales' | null // what stopped the count when none was asked for
  estimated: boolean // part of the total is beyond the stored price levels
  soldPerDay: number | null // estimate for the product; null = too little history
}

export interface CraftsResponse {
  house: number
  takenAt: number | null
  ahCut: number
  count: number | null // crafts asked for; null = as many as are worth making
  professions: Array<{ id: string; name: string }>
  crafts: Craft[]
}

export const craftsApi = {
  list: (params: { count?: number } = {}) => get<CraftsResponse>('/api/crafts', params),
}

// --- Vendor ---

export interface VendorDeal {
  id: number
  name: string | null
  quality: string | null
  vendorPrice: number
  minPrice: number
  quantity: number // units listed below the vendor price
  cost: number
  profit: number
}

export interface VendorResponse {
  house: number
  takenAt: number | null
  priced: number
  unpriced: number // items still waiting for a vendor price
  deals: VendorDeal[]
}

export const vendorApi = {
  list: () => get<VendorResponse>('/api/vendor'),
}

// --- Resets ---

export interface Reset {
  id: number
  name: string | null
  quality: string | null
  units: number // to buy
  cost: number
  floor: number // cheapest price now
  newFloor: number // cheapest price after the buyout
  normal: number // 7-day median of the cheapest price
  remaining: number // units still listed afterwards
  profit: number
  soldPerDay: number | null // estimate; null = too little history
}

export interface ResetsResponse {
  house: number
  takenAt: number | null
  ahCut: number
  maxCost: number
  minRise: number
  resets: Reset[]
}

export const resetsApi = {
  get: (params: { maxCost?: number; minRise?: number }) => get<ResetsResponse>('/api/resets', params),
}

// --- Track record ---

export interface Outcome {
  id: number
  kind: 'deal' | 'reset'
  itemId: number
  name: string | null
  quality: string | null
  takenAt: number
  units: number
  cost: number
  expectedProfit: number
  status: 'pending' | 'unlisted' | 'judged' // pending = not a day old; unlisted = none on sale a day later
  laterPrice: number | null
  actualProfit: number | null
}

export interface KindSummary {
  kind: 'deal' | 'reset'
  saved: number
  judged: number
  profitable: number
  cost: number
  expectedProfit: number
  actualProfit: number
}

export interface RecordResponse {
  house: number
  ahCut: number
  since: number | null // null = nothing recorded yet
  summary: KindSummary[]
  recent: Outcome[] // once a day old
  pending: number // picks not a day old yet
}

export const recordApi = {
  get: () => get<RecordResponse>('/api/record'),
}

// --- Character profile ---

export interface ProfileProfession {
  id: string
  name: string
  kind: 'crafting' | 'gathering'
  skill: number | null // null = the character does not have it
}

export interface Profile {
  professions: ProfileProfession[]
}

export const profileApi = {
  get: () => get<Profile>('/api/profile'),
  // Replaces the whole profile: only the professions listed are kept.
  save: (skills: Record<string, number>) => send<Profile>('POST', '/api/profile', { skills }),
}
