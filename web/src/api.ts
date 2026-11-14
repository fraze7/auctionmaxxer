// Response shapes and one function per endpoint. Components never call fetch()
// themselves. Prices are whole copper and times are Unix seconds.

export interface Price {
  minPrice: number
  medianPrice: number
  quantity: number
  qtyAtMin: number
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
  show: 'deals' | 'falling'
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
  deals: (params: { show?: string; minProfit?: number; maxQty?: number }) =>
    get<DealsResponse>('/api/deals', params),
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

export const itemApi = {
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

// --- Profession levelling ---

export interface LevelMaterial {
  itemId: number
  name: string
  quantity: number
  crafted: number // of `quantity`, how many an earlier step made
  cost: number
  vendor: boolean
  estimated: boolean // priced partly beyond the stored order book
  via?: { name: string; quantity: number } // bought to craft this reagent
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
}

export interface LevellingResponse {
  house: number
  takenAt: number | null
  profession: { id: string; name: string }
  professions: Array<{ id: string; name: string }>
  from: number
  to: number
  reached: number
  complete: boolean
  totalCost: number
  brackets: Array<{ from: number; to: number; cost: number; complete: boolean }>
  steps: LevelStep[]
  shopping: LevelMaterial[]
}

export const levellingApi = {
  get: (params: { profession?: string; from?: number; to?: number }) =>
    get<LevellingResponse>('/api/levelling', params),
}
