// Everything the web app knows about the server's API: the shape of each
// response, and one small function per endpoint. Components never call
// fetch() themselves - they go through here.
//
// Prices are whole copper and times are Unix seconds, exactly as the server
// sends them. Turning them into "12g 34s" or "5 min ago" is the UI's job.

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

// Thrown when the server can't be reached at all (as opposed to answering
// with an error). The UI uses it to suggest checking the SSH tunnel.
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
