import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api, type Deal, type DealsResponse, type Trend } from '../api.ts'
import { DataTable, type Column } from '../components/DataTable.tsx'
import { ItemName } from '../components/ItemName.tsx'
import { PriceTag } from '../components/PriceTag.tsx'
import { EmptyState, ErrorState, LoadingState } from '../components/States.tsx'
import { formatNumber, formatTrend } from '../format.ts'
import { toWholeNumber, useUrlParam } from '../useUrlParam.ts'

// The deals list: items priced well below their recent typical price, in a
// market that isn't simply falling. The rule itself runs on the server
// (server/src/deals.ts); this page sets the filters and shows the result.

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
      <span className={TREND_STYLE[d.trend]}>
        {formatTrend(d.trendRatio)} {d.trend}
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
  // Filters live in the URL, so a bookmarked view opens exactly as you left it.
  const [show, setShow] = useUrlParam('show', 'deals')
  const [minProfitText, setMinProfitText] = useUrlParam('minProfit')
  const [maxQtyText, setMaxQtyText] = useUrlParam('maxQty')

  const params = {
    show: show === 'falling' ? 'falling' : 'deals',
    minProfit: toWholeNumber(minProfitText),
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
          <h1 className="text-lg font-semibold text-zinc-100">
            {params.show === 'falling' ? 'Falling markets' : 'Deals'}
          </h1>
          <p className="text-sm text-zinc-500">
            {params.show === 'falling'
              ? 'Items whose price is dropping. Cheap, but not deals: the price is still on its way down.'
              : 'Priced well below their recent typical price, ranked by profit after the AH cut.'}
          </p>
        </div>

        <div className="flex rounded-md border border-zinc-700 text-sm">
          <Toggle active={params.show === 'deals'} onClick={() => setShow('deals')}>
            Deals
          </Toggle>
          <Toggle active={params.show === 'falling'} onClick={() => setShow('falling')}>
            Falling
          </Toggle>
        </div>

        {params.show === 'deals' && (
          <NumberField
            label="Min profit / unit (copper)"
            value={minProfitText}
            onChange={setMinProfitText}
            placeholder={String(settings.data?.dealMinProfit ?? 1)}
            preview={params.minProfit}
          />
        )}
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
          falling below {formatTrend(settings.data.dealTrendFalling)}, rising above{' '}
          {formatTrend(settings.data.dealTrendRising)}
        </p>
      )}
    </div>
  )
}

function Results({ data }: { data: DealsResponse }) {
  // Not enough history yet: say so, with progress, instead of a blank table.
  if (!data.history.ready) {
    const { snapshots, needed } = data.history
    const percent = Math.min(100, Math.round((snapshots / needed) * 100))
    return (
      <EmptyState title={`Collecting history: ${snapshots} of ${needed} snapshots`}>
        <p>
          A deal is judged against an item's own recent prices, so the list stays empty until there are {needed}{' '}
          hourly snapshots. About {needed - snapshots} more hours to go.
        </p>
        <div className="mx-auto mt-4 h-2 max-w-sm overflow-hidden rounded-full bg-zinc-800">
          <div className="h-full bg-amber-500" style={{ width: `${percent}%` }} />
        </div>
      </EmptyState>
    )
  }

  if (data.deals.length === 0) {
    return (
      <EmptyState title={data.show === 'falling' ? 'No falling markets right now' : 'No deals right now'}>
        <p>
          {formatNumber(data.history.itemsJudged)} items were checked against the rule.
          {data.show === 'deals' && ' Try a lower minimum profit, or check back after the next snapshot.'}
        </p>
      </EmptyState>
    )
  }

  return (
    <DataTable
      rows={data.deals}
      columns={columns}
      rowKey={(d) => d.id}
      initialSort={data.show === 'falling' ? { key: 'trend', direction: 'asc' } : { key: 'total', direction: 'desc' }}
    />
  )
}

function Toggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        'px-3 py-1.5 first:rounded-l-md last:rounded-r-md',
        active ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-100',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

interface NumberFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  preview?: number | undefined // shown as a price next to the label, e.g. 1g 50s
}

function NumberField({ label, value, onChange, placeholder, preview }: NumberFieldProps) {
  return (
    <label className="block text-xs text-zinc-400">
      <span className="flex justify-between gap-3">
        {label}
        {preview !== undefined && (
          <span className="text-zinc-300">
            <PriceTag copper={preview} />
          </span>
        )}
      </span>
      <input
        type="text"
        inputMode="numeric"
        value={value}
        placeholder={placeholder}
        // Keep digits only, so the URL never carries something the API rejects.
        onChange={(event) => onChange(event.target.value.replace(/\D/g, ''))}
        className="tabular mt-1 w-44 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
      />
    </label>
  )
}
