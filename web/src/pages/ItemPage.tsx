import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { itemApi, type HistoryPoint, type ItemDetail, type PriceLevel, type Trend } from '../api.ts'
import { HistoryChart, SERIES_COLOR } from '../components/HistoryChart.tsx'
import { ItemName } from '../components/ItemName.tsx'
import { PriceTag } from '../components/PriceTag.tsx'
import { EmptyState, ErrorState, LoadingState } from '../components/States.tsx'
import { formatCopperShort, formatCountShort, formatDateTime, formatNumber, formatTrend } from '../format.ts'
import { useUrlParam } from '../useUrlParam.ts'
import { RemoveButton, RuleText, useWatchlist, WatchForm, WatchStatus } from '../watchlist.tsx'

const RANGES = [
  { days: 1, label: '24 hours' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
]

const TREND_STYLE: Record<Trend, string> = {
  falling: 'text-red-400',
  stable: 'text-zinc-200',
  rising: 'text-green-400',
}

export function ItemPage() {
  const id = Number(useParams().id)
  const [daysText, setDaysText] = useUrlParam('days', '7')
  const days = RANGES.some((r) => String(r.days) === daysText) ? Number(daysText) : 7

  const validId = Number.isInteger(id) && id > 0
  const detail = useQuery({ queryKey: ['item', id], queryFn: () => itemApi.detail(id), enabled: validId })
  const history = useQuery({
    queryKey: ['item-history', id, days],
    queryFn: () => itemApi.history(id, days),
    enabled: validId,
    placeholderData: keepPreviousData, // keep the chart up while another range loads
  })

  if (!validId) return <EmptyState title="That isn't an item ID" />
  if (detail.isPending) return <LoadingState />
  if (detail.isError) return <ErrorState error={detail.error} />
  const item = detail.data

  return (
    <div className="space-y-6">
      <div>
        <Link to="/items" className="text-xs text-zinc-500 hover:text-zinc-300">
          ← All items
        </Link>
        <h1 className="mt-1 text-xl font-semibold">
          <ItemName id={item.id} name={item.name} quality={item.quality} link={false} />
        </h1>
        <p className="text-xs text-zinc-500">
          Item #{item.id}
          {item.nameStatus === 'pending' && ' · name not looked up yet'}
          {item.nameStatus === 'missing' && ' · Blizzard has no name for this item'}
          {item.takenAt && ` · prices from ${formatDateTime(item.takenAt)}`}
        </p>
      </div>

      <Stats item={item} />

      <PriceAlert item={item} />

      <Card
        title="Price"
        subtitle="Cheapest listing and the median across everything listed, at each snapshot"
        action={
          <div className="flex rounded-md border border-zinc-700 text-xs">
            {RANGES.map((range) => (
              <button
                key={range.days}
                type="button"
                aria-pressed={days === range.days}
                onClick={() => setDaysText(String(range.days))}
                className={[
                  'px-2.5 py-1 first:rounded-l-md last:rounded-r-md',
                  days === range.days ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-100',
                ].join(' ')}
              >
                {range.label}
              </button>
            ))}
          </div>
        }
      >
        <History state={history}>
          {(points) => (
            <HistoryChart
              points={points}
              height={280}
              series={[
                { key: 'minPrice', label: 'Min price', color: SERIES_COLOR.min },
                { key: 'medianPrice', label: 'Median price', color: SERIES_COLOR.median },
              ]}
              formatAxis={formatCopperShort}
              renderValue={(value) => <PriceTag copper={value} />}
            />
          )}
        </History>
      </Card>

      {/* Supply gets its own charts: a different unit needs its own axis. */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Total quantity listed" subtitle="A sharp drop can mean a buyout, often before a price rise">
          <History state={history}>
            {(points) => (
              <HistoryChart
                points={points}
                height={180}
                series={[{ key: 'quantity', label: 'Units listed', color: SERIES_COLOR.supply }]}
                formatAxis={formatCountShort}
                renderValue={formatNumber}
              />
            )}
          </History>
        </Card>
        <Card title="Listings" subtitle="Separate auctions - a rough count of sellers">
          <History state={history}>
            {(points) => (
              <HistoryChart
                points={points}
                height={180}
                series={[{ key: 'listingCount', label: 'Listings', color: SERIES_COLOR.supply }]}
                formatAxis={formatCountShort}
                renderValue={formatNumber}
              />
            )}
          </History>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Cheapest listings" subtitle="What it costs to buy a given amount right now">
          <OrderBook levels={item.levels} />
        </Card>
        <Card title="Snapshots" subtitle="The numbers behind the charts, newest first">
          <History state={history}>{(points) => <HistoryTable points={points} />}</History>
        </Card>
      </div>
    </div>
  )
}

// --- Headline numbers ---

function Stats({ item }: { item: ItemDetail }) {
  if (!item.price) {
    return (
      <EmptyState title="Not listed right now">
        <p>Nobody had this item on the auction house in the latest snapshot. Its history is below.</p>
      </EmptyState>
    )
  }
  const { price, trend } = item
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Stat label="Current min">
        <PriceTag copper={price.minPrice} />
      </Stat>
      <Stat label="Median">
        <PriceTag copper={price.medianPrice} />
      </Stat>
      <Stat label="Qty at min">{formatNumber(price.qtyAtMin)}</Stat>
      <Stat label="Total listed">{formatNumber(price.quantity)}</Stat>
      <Stat label="Listings">{formatNumber(price.listingCount)}</Stat>
      <Stat label="Trend" hint={trend ? '24h median vs 7d median' : 'needs more history'}>
        {trend ? (
          <span className={TREND_STYLE[trend.trend]}>
            {trend.trend} {formatTrend(trend.trendRatio)}
          </span>
        ) : (
          <span className="text-zinc-600">-</span>
        )}
      </Stat>
    </div>
  )
}

function Stat({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="tabular mt-0.5 text-base text-zinc-100">{children}</div>
      {hint && <div className="text-[11px] text-zinc-600">{hint}</div>}
    </div>
  )
}

// --- Price alert ---

function PriceAlert({ item }: { item: ItemDetail }) {
  const watchlist = useWatchlist()
  const mine = watchlist.data?.watches.filter((w) => w.itemId === item.id) ?? []

  return (
    <Card
      title="Price alert"
      subtitle="Checked against every new snapshot; fires once each time the price crosses your number"
      action={
        <Link to="/watchlist" className="text-xs text-zinc-500 hover:text-zinc-300">
          All alerts →
        </Link>
      }
    >
      {/* key: reset the form per item, and once saved rules load. */}
      <WatchForm
        key={`${item.id}-${watchlist.isSuccess}`}
        itemId={item.id}
        currentMin={item.price?.minPrice ?? null}
        existing={mine}
      />
      {mine.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-zinc-800 pt-3 text-sm">
          {mine.map((watch) => (
            <li key={watch.id} className="flex flex-wrap items-center gap-3">
              <span className="text-zinc-400">{watch.direction === 'below' ? 'Buy alert:' : 'Sell alert:'}</span>
              <RuleText direction={watch.direction} threshold={watch.threshold} />
              <WatchStatus watch={watch} />
              <RemoveButton id={watch.id} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

// --- Layout helpers ---

interface CardProps {
  title: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
}

function Card({ title, subtitle, action, children }: CardProps) {
  return (
    <section className="rounded-lg border border-zinc-800 p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-zinc-100">{title}</h2>
          {subtitle && <p className="text-xs text-zinc-500">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

// Loading, error and empty handling for everything drawn from history.
interface HistoryProps {
  state: { isPending: boolean; isError: boolean; error: unknown; data?: { points: HistoryPoint[] } | undefined }
  children: (points: HistoryPoint[]) => ReactNode
}

function History({ state, children }: HistoryProps) {
  if (state.isPending) return <p className="py-6 text-center text-sm text-zinc-500">Loading…</p>
  if (state.isError) return <ErrorState error={state.error} />
  const points = state.data?.points ?? []
  if (points.length === 0) {
    return <p className="py-6 text-center text-sm text-zinc-500">No snapshots in this period.</p>
  }
  return children(points)
}

// --- Tables ---

// The order book with running totals.
function OrderBook({ levels }: { levels: PriceLevel[] }) {
  if (levels.length === 0) return <p className="py-6 text-center text-sm text-zinc-500">Nothing listed.</p>

  let units = 0
  let cost = 0
  const rows = levels.map((level) => {
    units += level.quantity
    cost += level.quantity * level.unitPrice
    return { ...level, units, cost }
  })

  return (
    <SmallTable headers={['Unit price', 'Quantity', 'Running total', 'Cost to buy all so far']}>
      {rows.map((row) => (
        <tr key={row.unitPrice}>
          <Cell>
            <PriceTag copper={row.unitPrice} />
          </Cell>
          <Cell>{formatNumber(row.quantity)}</Cell>
          <Cell>{formatNumber(row.units)}</Cell>
          <Cell>
            <PriceTag copper={row.cost} />
          </Cell>
        </tr>
      ))}
    </SmallTable>
  )
}

function HistoryTable({ points }: { points: HistoryPoint[] }) {
  const newestFirst = [...points].reverse()
  return (
    <div className="max-h-96 overflow-y-auto">
      <SmallTable headers={['Snapshot', 'Min', 'Median', 'Listed', 'Listings']}>
        {newestFirst.map((point) => (
          <tr key={point.takenAt}>
            <Cell align="left">{formatDateTime(point.takenAt)}</Cell>
            <Cell>
              <PriceTag copper={point.minPrice} />
            </Cell>
            <Cell>
              <PriceTag copper={point.medianPrice} />
            </Cell>
            <Cell>{formatNumber(point.quantity)}</Cell>
            <Cell>{formatNumber(point.listingCount)}</Cell>
          </tr>
        ))}
      </SmallTable>
    </div>
  )
}

function SmallTable({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-xs text-zinc-500">
        <tr>
          {headers.map((header, index) => (
            <th key={header} className={`pb-1.5 font-medium ${index === 0 ? 'text-left' : 'text-right'}`}>
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-zinc-800/70">{children}</tbody>
    </table>
  )
}

function Cell({ align = 'right', children }: { align?: 'left' | 'right'; children: ReactNode }) {
  return <td className={`tabular py-1 ${align === 'left' ? 'text-left text-zinc-400' : 'text-right'}`}>{children}</td>
}
