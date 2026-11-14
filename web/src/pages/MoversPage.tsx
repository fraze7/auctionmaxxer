import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { moversApi, type Mover } from '../api.ts'
import { DataTable, type Column } from '../components/DataTable.tsx'
import { ItemName } from '../components/ItemName.tsx'
import { PriceTag } from '../components/PriceTag.tsx'
import { EmptyState, ErrorState, LoadingState } from '../components/States.tsx'
import { formatDateTime, formatNumber } from '../format.ts'
import { toWholeNumber, useUrlParam } from '../useUrlParam.ts'

// The biggest price rises and falls. Worked out on the server (server/src/movers.ts).

const RANGES = [
  { hours: 6, label: '6 hours' },
  { hours: 24, label: '24 hours' },
  { hours: 72, label: '3 days' },
  { hours: 168, label: '7 days' },
]
const DEFAULT_MIN_QUANTITY = 50
const DEFAULT_MIN_SILVER = 10

export function MoversPage() {
  const [hoursText, setHoursText] = useUrlParam('hours', '24')
  const hours = RANGES.some((range) => String(range.hours) === hoursText) ? Number(hoursText) : 24
  const [minText, setMinText] = useUrlParam('min')
  const minQuantity = toWholeNumber(minText) || DEFAULT_MIN_QUANTITY
  // In silver; an empty box means the default, 0 means no limit.
  const [worthText, setWorthText] = useUrlParam('worth')
  const minPrice = (toWholeNumber(worthText) ?? DEFAULT_MIN_SILVER) * 100

  const movers = useQuery({
    queryKey: ['movers', hours, minQuantity, minPrice],
    queryFn: () => moversApi.get({ hours, minQuantity, minPrice }),
    placeholderData: keepPreviousData,
    refetchInterval: 5 * 60_000,
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">Movers</h1>
          <p className="text-sm text-zinc-500">Items whose typical price has changed the most.</p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="block text-xs text-zinc-400">
            Worth at least (silver)
            <input
              type="text"
              inputMode="numeric"
              value={worthText}
              placeholder={String(DEFAULT_MIN_SILVER)}
              onChange={(event) => setWorthText(event.target.value.replace(/\D/g, '').slice(0, 6))}
              className="tabular mt-1 block w-24 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none"
            />
          </label>
          <label className="block text-xs text-zinc-400">
            At least on sale
            <input
              type="text"
              inputMode="numeric"
              value={minText}
              placeholder={String(DEFAULT_MIN_QUANTITY)}
              onChange={(event) => setMinText(event.target.value.replace(/\D/g, '').slice(0, 6))}
              className="tabular mt-1 block w-24 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none"
            />
          </label>
          <div className="flex rounded-md border border-zinc-700 text-sm">
            {RANGES.map((range) => (
              <button
                key={range.hours}
                type="button"
                aria-pressed={hours === range.hours}
                onClick={() => setHoursText(String(range.hours))}
                className={[
                  'px-3 py-1.5 first:rounded-l-md last:rounded-r-md',
                  hours === range.hours ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-100',
                ].join(' ')}
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {movers.isPending ? (
        <LoadingState />
      ) : movers.isError ? (
        <ErrorState error={movers.error} />
      ) : movers.data.comparedTo === null ? (
        <EmptyState title="Not enough history yet">
          <p>Movers need at least two snapshots to compare.</p>
        </EmptyState>
      ) : (
        <>
          <div className="grid gap-6 xl:grid-cols-2">
            <Side title="Rising" rows={movers.data.risers} />
            <Side title="Falling" rows={movers.data.fallers} />
          </div>
          <p className="text-xs text-zinc-500">
            Compared with prices from {formatDateTime(movers.data.comparedTo)}. The change is in the median price, the
            middle of everything listed, and only counts when the cheapest listing moved the same way. Items with
            fewer than {formatNumber(movers.data.minQuantity)} on sale, or only a handful of listings, are left out, as are items that
            were never worth the minimum price.
          </p>
        </>
      )}
    </div>
  )
}

function Side({ title, rows }: { title: string; rows: Mover[] }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-zinc-100">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500">Nothing {title.toLowerCase()} in this period.</p>
      ) : (
        <DataTable rows={rows} columns={COLUMNS} rowKey={(mover) => mover.id} />
      )}
    </section>
  )
}

const COLUMNS: Column<Mover>[] = [
  {
    key: 'item',
    header: 'Item',
    render: (mover) => <ItemName id={mover.id} name={mover.name} quality={mover.quality} />,
    sortValue: (mover) => mover.name ?? '',
  },
  {
    key: 'before',
    header: 'Was',
    align: 'right',
    render: (mover) => <PriceTag copper={mover.before} />,
    sortValue: (mover) => mover.before,
  },
  {
    key: 'now',
    header: 'Now',
    align: 'right',
    render: (mover) => <PriceTag copper={mover.now} />,
    sortValue: (mover) => mover.now,
  },
  {
    key: 'change',
    header: 'Change',
    align: 'right',
    render: (mover) => (
      <span className={mover.change > 1 ? 'tabular text-emerald-400' : 'tabular text-red-400'}>
        {mover.change > 1 ? '+' : '−'}
        {formatNumber(Math.round(Math.abs(mover.change - 1) * 100))}%
      </span>
    ),
    sortValue: (mover) => mover.change,
  },
  {
    key: 'quantity',
    header: 'On sale',
    align: 'right',
    render: (mover) => formatNumber(mover.quantity),
    sortValue: (mover) => mover.quantity,
  },
]
