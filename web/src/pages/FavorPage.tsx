import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { favorApi, type FavorCrate, type FavorResponse, type HourStretch } from '../api.ts'
import { DataTable, type Column } from '../components/DataTable.tsx'
import { PriceTag } from '../components/PriceTag.tsx'
import { EmptyState, ErrorState, LoadingState } from '../components/States.tsx'
import { formatNumber } from '../format.ts'
import { toWholeNumber, useUrlParam } from '../useUrlParam.ts'

// The cheapest way to turn gold into Merchant's Favor: a shopping plan for a
// target amount, then every crate. Priced on the server (server/src/favor.ts).

const DEFAULT_TARGET = 90 // the dearest recipes cost 90
const PRESETS = [30, 60, 90, 300]

export function FavorPage() {
  // An empty box means the default, shown as the placeholder.
  const [targetText, setTargetText] = useUrlParam('target')
  const parsed = toWholeNumber(targetText)
  const target = parsed && parsed <= 5000 ? parsed : DEFAULT_TARGET

  const favor = useQuery({
    queryKey: ['favor', target],
    queryFn: () => favorApi.get(target),
    placeholderData: keepPreviousData,
    refetchInterval: 5 * 60_000,
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-4">
        <div className="mr-auto">
          <h1 className="text-lg font-semibold text-zinc-100">Merchant's Favor</h1>
          <p className="text-sm text-zinc-500">
            The cheapest Waylaid Crates to buy, fill and hand in, at current auction prices.
          </p>
          {favor.data && <CrateHours hours={favor.data.crateHours} />}
        </div>

        <div className="flex rounded-md border border-zinc-700 text-sm">
          {PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              aria-pressed={target === preset}
              onClick={() => setTargetText(String(preset))}
              className={[
                'tabular px-3 py-1.5 first:rounded-l-md last:rounded-r-md',
                target === preset ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-100',
              ].join(' ')}
            >
              {preset}
            </button>
          ))}
        </div>
        <label className="block text-xs text-zinc-400">
          Favor wanted
          <input
            type="text"
            inputMode="numeric"
            value={targetText}
            placeholder={String(DEFAULT_TARGET)}
            onChange={(event) => setTargetText(event.target.value.replace(/\D/g, '').slice(0, 4))}
            className="tabular mt-1 block w-28 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none"
          />
        </label>
      </div>

      {favor.isPending ? (
        <LoadingState />
      ) : favor.isError ? (
        <ErrorState error={favor.error} />
      ) : (
        <>
          <Plan data={favor.data} />
          <CrateTable crates={favor.data.crates} />
          <Notes anyEstimated={favor.data.crates.some((c) => c.favorEstimated)} />
        </>
      )}
    </div>
  )
}

// --- The shopping plan ---

function Plan({ data }: { data: FavorResponse }) {
  const { plan } = data
  if (plan.steps.length === 0) {
    return (
      <EmptyState title="Nothing can be filled right now">
        <p>No crate has both the crate itself and one of its bundles on the auction house at the moment.</p>
      </EmptyState>
    )
  }

  const usesEstimate = plan.steps.some((step) => step.favorEstimated)

  return (
    <section className="rounded-lg border border-zinc-800 p-4">
      <h2 className="text-sm font-medium text-zinc-100">Shopping plan for {formatNumber(plan.target)} favor</h2>
      <p className="text-xs text-zinc-500">
        Buys the cheapest fill first, then re-prices: each purchase uses up the cheapest listings, so later ones
        cost more.
      </p>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total cost">
          <PriceTag copper={plan.totalCost} />
        </Stat>
        <Stat label="Favor earned" hint={plan.favor > plan.target ? 'the last crate overshoots' : undefined}>
          {formatNumber(plan.favor)}
          {usesEstimate && <Estimate />}
        </Stat>
        <Stat label="Cost per favor">
          <PriceTag copper={Math.round(plan.totalCost / plan.favor)} />
        </Stat>
        <Stat label="Crates to hand in">{formatNumber(plan.steps.reduce((sum, s) => sum + s.count, 0))}</Stat>
      </div>

      {!plan.complete && (
        <p className="mt-3 rounded-md border border-amber-800 bg-amber-950/60 px-3 py-2 text-sm text-amber-200">
          The auction house only has enough listed for {formatNumber(plan.favor)} of the{' '}
          {formatNumber(plan.target)} favor you asked for.
        </p>
      )}

      <table className="mt-4 w-full text-sm">
        <thead className="text-xs text-zinc-500">
          <tr>
            <th className="pb-1.5 text-left font-medium">Buy</th>
            <th className="pb-1.5 text-left font-medium">Fill each with</th>
            <th className="pb-1.5 text-right font-medium">Crates cost</th>
            <th className="pb-1.5 text-right font-medium">Materials cost</th>
            <th className="pb-1.5 text-right font-medium">Favor</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/70">
          {plan.steps.map((step) => (
            <tr key={`${step.crateId}:${step.bundleItemId}`}>
              <td className="py-1.5">
                <span className="tabular text-zinc-400">{step.count} × </span>
                <ItemLink id={step.crateId}>Waylaid Crate: {step.crateName}</ItemLink>
              </td>
              <td className="py-1.5">
                <span className="tabular text-zinc-400">{step.bundleQuantity} × </span>
                <ItemLink id={step.bundleItemId}>{step.bundleItemName}</ItemLink>
                <span className="tabular text-zinc-500">
                  {' '}
                  ({formatNumber(step.bundleQuantity * step.count)} in all)
                </span>
              </td>
              <td className="tabular py-1.5 text-right">
                <PriceTag copper={step.crateCost} />
              </td>
              <td className="tabular py-1.5 text-right">
                <PriceTag copper={step.materialsCost} />
              </td>
              <td className="tabular py-1.5 text-right">
                {formatNumber(step.favorEach * step.count)}
                {step.favorEstimated && <Estimate />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

// --- Every crate, one fill each ---

const columns: Column<FavorCrate>[] = [
  {
    key: 'crate',
    header: 'Crate',
    render: (c) => (
      <span>
        <ItemLink id={c.itemId}>{c.name}</ItemLink>
        {c.crafted && (
          <span className="ml-2 text-xs text-green-500" title="Crafted-material crate: pays double favor">
            crafted
          </span>
        )}
      </span>
    ),
    sortValue: (c) => c.name,
  },
  {
    key: 'favor',
    header: 'Favor',
    align: 'right',
    render: (c) => (
      <>
        {c.favor}
        {c.favorEstimated && <Estimate />}
      </>
    ),
    sortValue: (c) => c.favor,
  },
  {
    key: 'cratePrice',
    header: 'Crate',
    title: 'Cheapest crate on the auction house',
    align: 'right',
    render: (c) => (c.cratePrice === null ? <Muted>none listed</Muted> : <PriceTag copper={c.cratePrice} />),
    sortValue: (c) => c.cratePrice,
  },
  {
    key: 'fill',
    header: 'Cheapest fill',
    title: 'The cheapest of the bundles this crate accepts. Hover the others to compare.',
    render: (c) => <Bundles crate={c} />,
  },
  {
    key: 'materials',
    header: 'Materials',
    align: 'right',
    render: (c) => (c.best ? <PriceTag copper={c.best.materialsCost} /> : <Muted>-</Muted>),
    sortValue: (c) => c.best?.materialsCost ?? null,
  },
  {
    key: 'total',
    header: 'Total',
    title: 'Crate + materials, for one hand-in',
    align: 'right',
    render: (c) => (c.best ? <PriceTag copper={c.best.totalCost} /> : <Muted>-</Muted>),
    sortValue: (c) => c.best?.totalCost ?? null,
  },
  {
    key: 'perFavor',
    header: 'Per favor',
    title: 'Total cost divided by the favor it pays - lower is better',
    align: 'right',
    render: (c) =>
      c.best ? (
        <span className="font-medium text-zinc-100">
          <PriceTag copper={Math.round(c.best.copperPerFavor)} />
        </span>
      ) : (
        <Muted>can't fill</Muted>
      ),
    sortValue: (c) => c.best?.copperPerFavor ?? null,
  },
]

function CrateTable({ crates }: { crates: FavorCrate[] }) {
  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-sm font-medium text-zinc-100">All crates</h2>
        <p className="text-xs text-zinc-500">
          The price of one hand-in of each crate right now. Prices climb as you buy more; the plan above accounts
          for that, this table does not.
        </p>
      </div>
      <DataTable
        rows={crates}
        columns={columns}
        rowKey={(c) => c.itemId}
        initialSort={{ key: 'perFavor', direction: 'asc' }}
      />
    </section>
  )
}

// Cheapest bundle first; the alternatives are dimmed.
function Bundles({ crate }: { crate: FavorCrate }) {
  const bestIndex = crate.best?.bundleIndex
  const ordered = crate.bundles
    .map((bundle, index) => ({ bundle, index }))
    .sort((a, b) => Number(b.index === bestIndex) - Number(a.index === bestIndex))

  return (
    <span className="flex flex-wrap gap-x-3 gap-y-0.5">
      {ordered.map(({ bundle, index }) => {
        const label = `${bundle.quantity} × ${bundle.itemName}`
        const className = index === bestIndex ? 'text-zinc-100' : 'text-zinc-600'
        const hint =
          bundle.cost === null
            ? `Only ${formatNumber(bundle.listed)} listed - not enough for a crate`
            : `${(bundle.cost / 10_000).toFixed(2)}g for the bundle`
        return bundle.itemId === null ? (
          <span key={index} className={className} title="Never seen on the auction house">
            {label}
          </span>
        ) : (
          <Link key={index} to={`/item/${bundle.itemId}`} title={hint} className={`${className} hover:underline`}>
            {label}
          </Link>
        )
      })}
    </span>
  )
}

// --- Small pieces ---

function Notes({ anyEstimated }: { anyEstimated: boolean }) {
  return (
    <ul className="list-disc space-y-1 pl-5 text-xs text-zinc-500">
      {anyEstimated && (
        <li>
          <Estimate /> Artisan crates are assumed to pay 20 favor (40 if crafted), continuing the pattern of the
          lower tiers. Wowhead doesn't list their reward yet.
        </li>
      )}
      <li>Your first crate ever also pays a one-time 50 favor, on top of what is shown here.</li>
      <li>
        Only the cheapest 20 price levels of each item are stored, so a very large target can report the market
        as running out slightly early.
      </li>
      <li>Any daily limit on hand-ins isn't modelled: no source gives a number for one.</li>
    </ul>
  )
}

function Estimate() {
  return (
    <span className="ml-0.5 text-amber-400" title="Estimated: this crate's favor reward isn't confirmed yet">
      *
    </span>
  )
}

function Muted({ children }: { children: ReactNode }) {
  return <span className="text-zinc-600">{children}</span>
}

function ItemLink({ id, children }: { id: number; children: ReactNode }) {
  return (
    <Link to={`/item/${id}`} className="text-zinc-100 hover:underline">
      {children}
    </Link>
  )
}

function Stat({ label, hint, children }: { label: string; hint?: string | undefined; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="tabular mt-0.5 text-base text-zinc-100">{children}</div>
      {hint && <div className="text-[11px] text-zinc-600">{hint}</div>}
    </div>
  )
}

const clock = (hour: number) => `${String(hour).padStart(2, '0')}:00`
const percent = (ratio: number) => Math.round(Math.abs(ratio - 1) * 100)

// Only shown when the week's odd and even days agree (server/src/hours.ts).
function CrateHours({ hours }: { hours: FavorResponse['crateHours'] }) {
  const { cheapest, dearest } = hours
  if (!cheapest) return null
  const stretch = (s: HourStretch) => `${clock(s.from)}-${clock(s.to)} UTC`
  return (
    <p className="mt-1 text-sm text-emerald-300/90">
      Crates have been cheapest around {stretch(cheapest)} this week, about {percent(cheapest.ratio)}% under the day's
      usual price
      {dearest && (
        <>
          , and dearest around {stretch(dearest)} (about {percent(dearest.ratio)}% over)
        </>
      )}
      .
    </p>
  )
}
