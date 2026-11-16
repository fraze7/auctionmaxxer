import { useQuery } from '@tanstack/react-query'
import { recordApi, type KindSummary, type Outcome } from '../api.ts'
import { DataTable, type Column } from '../components/DataTable.tsx'
import { ItemName } from '../components/ItemName.tsx'
import { PriceTag } from '../components/PriceTag.tsx'
import { EmptyState, ErrorState, LoadingState } from '../components/States.tsx'
import { formatDateTime, formatNumber } from '../format.ts'

// How the Deals and Resets picks turned out a day later. Worked out on the
// server (server/src/record.ts).

const KIND_NAME = { deal: 'Deals', reset: 'Resets' } as const

export function RecordPage() {
  const record = useQuery({ queryKey: ['record'], queryFn: recordApi.get, refetchInterval: 5 * 60_000 })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-zinc-100">Track record</h1>
        <p className="text-sm text-zinc-500">
          What the Deals tab recommended, as deals and as resets, and what the price was a day later.
        </p>
      </div>

      {record.isPending ? (
        <LoadingState />
      ) : record.isError ? (
        <ErrorState error={record.error} />
      ) : record.data.since === null ? (
        <EmptyState title="Nothing recorded yet">
          <p>The top picks are saved after each new snapshot, about once an hour.</p>
        </EmptyState>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            {record.data.summary.map((summary) => (
              <Summary key={summary.kind} summary={summary} />
            ))}
          </div>

          <section className="space-y-2">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-medium text-zinc-100">Recent picks, a day later</h2>
              {record.data.pending > 0 && (
                <span className="text-xs text-zinc-500">
                  {formatNumber(record.data.pending)} newer {record.data.pending === 1 ? 'pick is' : 'picks are'} not a
                  day old yet
                </span>
              )}
            </div>
            {record.data.recent.length === 0 ? (
              <EmptyState title="No pick is a day old yet">
                <p>Each pick is judged 24 hours after it was saved.</p>
              </EmptyState>
            ) : (
              <DataTable rows={record.data.recent} columns={COLUMNS} rowKey={(outcome) => outcome.id} />
            )}
            <p className="text-xs text-zinc-500">
              Recording since {formatDateTime(record.data.since)}. Each snapshot's top 20 deals and top 20 resets are
              saved, once per item per day. &ldquo;Actual&rdquo; is what you would have made buying as recommended and
              selling every unit at the cheapest price 24 hours later, after the auction house keeps{' '}
              {Math.round(record.data.ahCut * 100)}%. It is a yardstick, not a ledger: it cannot know whether the
              units would have sold.
            </p>
          </section>
        </>
      )}
    </div>
  )
}

function Summary({ summary }: { summary: KindSummary }) {
  const { judged, profitable } = summary
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-zinc-100">{KIND_NAME[summary.kind]}</h2>
        <span className="text-xs text-zinc-500">
          {formatNumber(summary.saved)} saved, {formatNumber(judged)} judged
        </span>
      </div>
      {judged === 0 ? (
        <p className="mt-2 text-sm text-zinc-500">No picks are a day old yet.</p>
      ) : (
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <Stat label="Made money">
            {formatNumber(profitable)} of {formatNumber(judged)} ({Math.round((profitable / judged) * 100)}%)
          </Stat>
          <Stat label="Spent">
            <PriceTag copper={summary.cost} />
          </Stat>
          <Stat label="Expected profit">
            <Signed copper={summary.expectedProfit} />
          </Stat>
          <Stat label="Actual profit">
            <Signed copper={summary.actualProfit} />
          </Stat>
        </dl>
      )}
    </div>
  )
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="tabular text-zinc-100">{children}</dd>
    </div>
  )
}

function Signed({ copper }: { copper: number }) {
  if (copper >= 0) return <PriceTag copper={copper} />
  return (
    <span className="text-red-400">
      −<PriceTag copper={-copper} />
    </span>
  )
}

const COLUMNS: Column<Outcome>[] = [
  {
    key: 'item',
    header: 'Item',
    render: (outcome) => <ItemName id={outcome.itemId} name={outcome.name} quality={outcome.quality} />,
    sortValue: (outcome) => outcome.name ?? '',
  },
  {
    key: 'kind',
    header: 'Tab',
    render: (outcome) => <span className="text-zinc-400">{KIND_NAME[outcome.kind]}</span>,
    sortValue: (outcome) => outcome.kind,
  },
  {
    key: 'takenAt',
    header: 'Picked',
    render: (outcome) => <span className="whitespace-nowrap text-zinc-400">{formatDateTime(outcome.takenAt)}</span>,
    sortValue: (outcome) => outcome.takenAt,
  },
  {
    key: 'units',
    header: 'Units',
    align: 'right',
    render: (outcome) => formatNumber(outcome.units),
    sortValue: (outcome) => outcome.units,
  },
  {
    key: 'cost',
    header: 'Cost',
    align: 'right',
    render: (outcome) => <PriceTag copper={outcome.cost} />,
    sortValue: (outcome) => outcome.cost,
  },
  {
    key: 'expected',
    header: 'Expected',
    align: 'right',
    render: (outcome) => <Signed copper={outcome.expectedProfit} />,
    sortValue: (outcome) => outcome.expectedProfit,
  },
  {
    key: 'actual',
    header: 'Actual',
    align: 'right',
    render: (outcome) =>
      outcome.actualProfit !== null ? (
        <Signed copper={outcome.actualProfit} />
      ) : (
        <span className="text-zinc-500">none on sale</span>
      ),
    sortValue: (outcome) => outcome.actualProfit ?? Number.NEGATIVE_INFINITY,
  },
]
