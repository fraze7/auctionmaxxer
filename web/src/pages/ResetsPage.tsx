import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { resetsApi, type Reset } from '../api.ts'
import { DataTable, type Column } from '../components/DataTable.tsx'
import { ItemName } from '../components/ItemName.tsx'
import { PriceTag } from '../components/PriceTag.tsx'
import { EmptyState, ErrorState, LoadingState } from '../components/States.tsx'
import { formatNumber } from '../format.ts'
import { toWholeNumber, useUrlParam } from '../useUrlParam.ts'

// Items where buying the cheapest listings leaves a much higher price.
// Worked out on the server (server/src/resets.ts).

const RISES = [
  { value: '1.25', label: '+25%' },
  { value: '1.5', label: '+50%' },
  { value: '2', label: '×2' },
  { value: '3', label: '×3' },
]
const DEFAULT_BUDGET_GOLD = 50

export function ResetsPage() {
  const [budgetText, setBudgetText] = useUrlParam('budget')
  const budget = toWholeNumber(budgetText) || DEFAULT_BUDGET_GOLD
  const [riseText, setRiseText] = useUrlParam('rise', '1.5')
  const rise = RISES.some((option) => option.value === riseText) ? riseText : '1.5'

  const resets = useQuery({
    queryKey: ['resets', budget, rise],
    queryFn: () => resetsApi.get({ maxCost: budget * 10_000, minRise: Number(rise) }),
    placeholderData: keepPreviousData,
    refetchInterval: 5 * 60_000,
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">Resets</h1>
          <p className="text-sm text-zinc-500">
            Items where buying the cheapest listings leaves a much higher price to relist at.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="block text-xs text-zinc-400">
            Budget (gold)
            <input
              type="text"
              inputMode="numeric"
              value={budgetText}
              placeholder={String(DEFAULT_BUDGET_GOLD)}
              onChange={(event) => setBudgetText(event.target.value.replace(/\D/g, '').slice(0, 5))}
              className="tabular mt-1 block w-24 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none"
            />
          </label>
          <div>
            <div className="mb-1 text-xs text-zinc-400">Price rise of at least</div>
            <div className="flex rounded-md border border-zinc-700 text-sm">
              {RISES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={rise === option.value}
                  onClick={() => setRiseText(option.value)}
                  className={[
                    'tabular px-3 py-1.5 first:rounded-l-md last:rounded-r-md',
                    rise === option.value ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-100',
                  ].join(' ')}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {resets.isPending ? (
        <LoadingState />
      ) : resets.isError ? (
        <ErrorState error={resets.error} />
      ) : resets.data.resets.length === 0 ? (
        <EmptyState title="No resets within this budget">
          <p>Nothing can be bought out for a rise this large. Try a bigger budget or a smaller rise.</p>
        </EmptyState>
      ) : (
        <>
          <DataTable
            rows={resets.data.resets}
            columns={COLUMNS}
            rowKey={(reset) => reset.id}
            initialSort={{ key: 'profit', direction: 'desc' }}
          />
          <p className="text-xs text-zinc-500">
            Profit assumes every unit you buy sells just under the new price, after the auction house keeps{' '}
            {Math.round(resets.data.ahCut * 100)}%. That is the risk: others can undercut you or list more, and the site
            cannot see how fast an item sells. The new price is never more than one and a half times the normal price
            (the 7-day median of the cheapest listing), and items with under 12 hours of history are left out. &ldquo;Sells / day&rdquo; is an estimate from cheap
            listings disappearing between hourly snapshots: it misses quick sales and counts cancelled listings and
            other people&rsquo;s buyouts as sales.
          </p>
        </>
      )}
    </div>
  )
}

// How long the units you buy would take to sell at the estimated rate.
function daysToSell(units: number, soldPerDay: number): string {
  if (soldPerDay <= 0) return 'none seen selling'
  const days = units / soldPerDay
  if (days < 1) return 'under a day of stock'
  return `${formatNumber(Math.round(days))} ${Math.round(days) === 1 ? 'day' : 'days'} of stock`
}

const COLUMNS: Column<Reset>[] = [
  {
    key: 'item',
    header: 'Item',
    render: (reset) => <ItemName id={reset.id} name={reset.name} quality={reset.quality} />,
    sortValue: (reset) => reset.name ?? '',
  },
  {
    key: 'units',
    header: 'Buy',
    align: 'right',
    render: (reset) => formatNumber(reset.units),
    sortValue: (reset) => reset.units,
  },
  {
    key: 'cost',
    header: 'Cost',
    align: 'right',
    render: (reset) => <PriceTag copper={reset.cost} />,
    sortValue: (reset) => reset.cost,
  },
  {
    key: 'floor',
    header: 'Cheapest now',
    align: 'right',
    render: (reset) => <PriceTag copper={reset.floor} />,
    sortValue: (reset) => reset.floor,
  },
  {
    key: 'newFloor',
    header: 'After',
    align: 'right',
    render: (reset) => <PriceTag copper={reset.newFloor} />,
    sortValue: (reset) => reset.newFloor,
  },
  {
    key: 'normal',
    header: 'Normal',
    align: 'right',
    render: (reset) => <PriceTag copper={reset.normal} />,
    sortValue: (reset) => reset.normal,
  },
  {
    key: 'remaining',
    header: 'Left on sale',
    align: 'right',
    render: (reset) => formatNumber(reset.remaining),
    sortValue: (reset) => reset.remaining,
  },
  {
    key: 'soldPerDay',
    header: 'Sells / day',
    align: 'right',
    render: (reset) =>
      reset.soldPerDay === null ? (
        '–'
      ) : (
        <span className="whitespace-nowrap">
          ~{formatNumber(Math.round(reset.soldPerDay))}
          <span className="block text-xs text-zinc-500">{daysToSell(reset.units, reset.soldPerDay)}</span>
        </span>
      ),
    sortValue: (reset) => reset.soldPerDay ?? -1,
  },
  {
    key: 'profit',
    header: 'Profit',
    align: 'right',
    render: (reset) => <PriceTag copper={reset.profit} />,
    sortValue: (reset) => reset.profit,
  },
]
