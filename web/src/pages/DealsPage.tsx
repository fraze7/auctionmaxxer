import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api, type Deal, type DealsResponse, type Trend } from '../api.ts'
import { DataTable, type Column } from '../components/DataTable.tsx'
import { ItemName } from '../components/ItemName.tsx'
import { PriceTag } from '../components/PriceTag.tsx'
import { SellRate } from '../components/SellRate.tsx'
import { ShowToggle, useView } from '../components/ShowToggle.tsx'
import { SELL_RATE_HINT } from '../sellRate.ts'
import { ResetsView } from './ResetsView.tsx'
import { EmptyState, ErrorState, LoadingState } from '../components/States.tsx'
import { formatNumber, formatTrend } from '../format.ts'
import { toWholeNumber, useUrlParam } from '../useUrlParam.ts'

// The deals list. The rule runs on the server (server/src/deals.ts).

const TREND_STYLE: Record<Trend, string> = {
  falling: 'text-red-400',
  stable: 'text-zinc-400',
  rising: 'text-green-400',
}

const columns: Column<Deal>[] = [
  {
    key: 'item',
    header: 'Item',
    render: (d) => <ItemName id={d.id} name={d.name} quality={d.quality} />,
    sortValue: (d) => d.name,
  },
  {
    key: 'min',
    header: 'Current min',
    title: 'Cheapest unit price right now',
    align: 'right',
    render: (d) => <PriceTag copper={d.minPrice} />,
    sortValue: (d) => d.minPrice,
  },
  {
    key: 'recent',
    header: '24h median',
    title: 'Median of the hourly minimum price over the last 24 hours',
    align: 'right',
    render: (d) => <PriceTag copper={d.recentMedian} />,
    sortValue: (d) => d.recentMedian,
  },
  {
    key: 'week',
    header: '7d median',
    title: 'Median of the hourly minimum price over the last 7 days',
    align: 'right',
    render: (d) => <PriceTag copper={d.weekMedian} />,
    sortValue: (d) => d.weekMedian,
  },
  {
    key: 'trend',
    header: 'Trend',
    title: 'How the last 24 hours compare with the last 7 days',
    align: 'right',
    render: (d) => (
      <span className={TREND_STYLE[d.trend]} title={`24h median ${formatTrend(d.trendRatio)} against the 7d median`}>
        {d.trend}
      </span>
    ),
    sortValue: (d) => d.trendRatio,
  },
  {
    key: 'profit',
    header: 'Profit / unit',
    title: 'Expected sale price after the AH cut, minus the current min',
    align: 'right',
    render: (d) => <PriceTag copper={d.profitPerUnit} />,
    sortValue: (d) => d.profitPerUnit,
  },
  {
    key: 'qty',
    header: 'Qty at min',
    title: 'Units on sale at the current min price',
    align: 'right',
    render: (d) => formatNumber(d.qtyAtMin),
    sortValue: (d) => d.qtyAtMin,
  },
  {
    key: 'soldPerDay',
    header: 'Sells',
    title: SELL_RATE_HINT,
    align: 'right',
    render: (d) => <SellRate soldPerDay={d.soldPerDay} />,
    sortValue: (d) => d.soldPerDay ?? -1,
  },
  {
    key: 'total',
    header: 'Total profit',
    title: 'Profit per unit x the units you would buy',
    align: 'right',
    render: (d) => (
      <span className="font-medium text-zinc-100">
        <PriceTag copper={d.totalProfit} />
      </span>
    ),
    sortValue: (d) => d.totalProfit,
  },
]

export function DealsPage() {
  return useView() === 'resets' ? <ResetsView /> : <DealsView />
}

function DealsView() {
  // Filters live in the URL, so views can be bookmarked.
  const [minProfitText, setMinProfitText] = useUrlParam('profit') // silver
  const [maxQtyText, setMaxQtyText] = useUrlParam('maxQty')

  const params = {
    minProfit: minProfitText ? (toWholeNumber(minProfitText) ?? 0) * 100 : undefined,
    maxQty: toWholeNumber(maxQtyText) || undefined, // 0 would be rejected; treat as "no cap"
  }

  const deals = useQuery({
    queryKey: ['deals', params],
    queryFn: () => api.deals(params),
    placeholderData: keepPreviousData, // keep the old rows on screen while a filter change loads
    refetchInterval: 5 * 60_000,
  })
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="mr-auto">
          <h1 className="text-lg font-semibold text-zinc-100">Deals</h1>
          <p className="text-sm text-zinc-500">
            Priced well below their recent typical price, ranked by profit after the AH cut.
          </p>
        </div>

        <ShowToggle />

        <NumberField
          label="Profit per unit of at least (silver)"
          value={minProfitText}
          onChange={setMinProfitText}
          placeholder="any"
        />
        <NumberField label="Max units to buy" value={maxQtyText} onChange={setMaxQtyText} placeholder="no cap" />
      </div>

      {deals.isPending ? (
        <LoadingState />
      ) : deals.isError ? (
        <ErrorState error={deals.error} />
      ) : (
        <Results data={deals.data} />
      )}

      {settings.data && (
        <p className="text-xs text-zinc-600">
          AH cut {Math.round(settings.data.ahCut * 100)}% · needs {settings.data.dealMinSnapshots} hourly snapshots ·
          deal when current min is at most {Math.round(settings.data.dealMaxPriceRatio * 100)}% of the 24h median ·
          never when the 24h median is more than {Math.round((1 - settings.data.dealTrendFalling) * 100)}% below the 7d
          median, since the price is still falling
        </p>
      )}
    </div>
  )
}

function Results({ data }: { data: DealsResponse }) {
  if (!data.history.ready) {
    const { snapshots, needed } = data.history
    const percent = Math.min(100, Math.round((snapshots / needed) * 100))
    return (
      <EmptyState title={`Collecting history: ${snapshots} of ${needed} snapshots`}>
        <p>
          A deal is judged against an item's own recent prices, so the list stays empty until there are {needed} hourly
          snapshots. About {needed - snapshots} more hours to go.
        </p>
        <div className="mx-auto mt-4 h-2 max-w-sm overflow-hidden rounded-full bg-zinc-800">
          <div className="h-full bg-amber-500" style={{ width: `${percent}%` }} />
        </div>
      </EmptyState>
    )
  }

  if (data.deals.length === 0) {
    return (
      <EmptyState title="No deals right now">
        <p>
          {formatNumber(data.history.itemsJudged)} items were checked against the rule. Try a lower minimum profit, or
          check back after the next snapshot.
        </p>
      </EmptyState>
    )
  }

  return (
    <DataTable
      rows={data.deals}
      columns={columns}
      rowKey={(d) => d.id}
      initialSort={{ key: 'total', direction: 'desc' }}
    />
  )
}

interface NumberFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

function NumberField({ label, value, onChange, placeholder }: NumberFieldProps) {
  return (
    <label className="block text-xs text-zinc-400">
      {label}
      <input
        type="text"
        inputMode="numeric"
        value={value}
        placeholder={placeholder}
        // Digits only, so the URL never carries something the API rejects.
        onChange={(event) => onChange(event.target.value.replace(/\D/g, ''))}
        className="tabular mt-1 block w-44 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
      />
    </label>
  )
}
