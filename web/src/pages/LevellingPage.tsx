import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { levellingApi, type LevelMaterial, type LevellingResponse, type LevelStep } from '../api.ts'
import { DataTable, type Column } from '../components/DataTable.tsx'
import { PriceTag } from '../components/PriceTag.tsx'
import { EmptyState, ErrorState, LoadingState } from '../components/States.tsx'
import { formatNumber } from '../format.ts'

// The cheapest way to level a profession at current prices. The route is
// worked out on the server (server/src/levelling.ts).

export function LevellingPage() {
  const levelling = useQuery({
    queryKey: ['levelling', 'alchemy'],
    queryFn: () => levellingApi.get({ profession: 'alchemy' }),
    placeholderData: keepPreviousData,
    refetchInterval: 5 * 60_000,
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-zinc-100">
          {levelling.data?.profession.name ?? 'Profession'} levelling
        </h1>
        <p className="text-sm text-zinc-500">
          The cheapest recipe for each skill point at current auction prices, using trainer recipes only.
        </p>
      </div>

      {levelling.isPending ? (
        <LoadingState />
      ) : levelling.isError ? (
        <ErrorState error={levelling.error} />
      ) : (
        <Plan plan={levelling.data} />
      )}
    </div>
  )
}

function Plan({ plan }: { plan: LevellingResponse }) {
  if (plan.steps.length === 0) {
    return (
      <EmptyState title="No route right now">
        <p>None of the recipes for skill {plan.from} can be made from what is on the auction house.</p>
      </EmptyState>
    )
  }

  return (
    <>
      {!plan.complete && (
        <div className="rounded-lg border border-amber-800 bg-amber-950/60 px-4 py-3 text-sm text-amber-200">
          The auction house runs out of materials at skill {plan.reached}. The costs below only cover {plan.from} to{' '}
          {plan.reached}.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {plan.brackets.map((bracket) => (
          <Tile key={bracket.from} label={`${bracket.from} to ${bracket.to}`} partial={!bracket.complete}>
            <PriceTag copper={bracket.cost} />
          </Tile>
        ))}
        {plan.brackets.length > 1 && (
          <Tile label={`Total, ${plan.from} to ${plan.reached}`} partial={!plan.complete}>
            <PriceTag copper={plan.totalCost} />
          </Tile>
        )}
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-zinc-100">Steps</h2>
        <DataTable rows={plan.steps} columns={STEP_COLUMNS} rowKey={(step) => step.from} />
        <p className="text-xs text-zinc-500">
          Crafts marked ~ are an average: those recipes no longer give a point every time, so you may need a few more
          or fewer. Trainer fees are not included, and nothing is deducted for selling what you make.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-zinc-100">Shopping list</h2>
        <DataTable
          rows={plan.shopping}
          columns={SHOPPING_COLUMNS}
          rowKey={(material) => material.itemId}
          initialSort={{ key: 'cost', direction: 'desc' }}
        />
        {plan.shopping.some((m) => m.estimated) && (
          <p className="text-xs text-zinc-500">
            * Needs more than the cheapest listings the site stores, so part of this cost is an estimate.
          </p>
        )}
      </section>
    </>
  )
}

const STEP_COLUMNS: Column<LevelStep>[] = [
  {
    key: 'skill',
    header: 'Skill',
    render: (step) => (
      <span className="tabular whitespace-nowrap text-zinc-300">
        {step.from} → {step.to}
      </span>
    ),
  },
  {
    key: 'craft',
    header: 'Craft',
    render: (step) => (
      <span className="whitespace-nowrap">
        <span className="tabular text-zinc-400">
          {step.guaranteed ? '' : '~'}
          {formatNumber(step.crafts)} ×
        </span>{' '}
        <a
          href={`https://www.wowhead.com/forever/spell=${step.spellId}`}
          target="_blank"
          rel="noreferrer"
          className="text-zinc-100 hover:underline"
        >
          {step.recipeName}
        </a>
      </span>
    ),
  },
  {
    key: 'materials',
    header: 'Materials',
    render: (step) => (
      <span className="text-zinc-300">
        {step.materials.map((material, index) => (
          <span key={material.itemId}>
            {index > 0 && ', '}
            <span className="tabular">{formatNumber(material.quantity)}</span> <MaterialName material={material} />
            {material.crafted > 0 && (
              <span className="text-zinc-500"> ({formatNumber(material.crafted)} made earlier)</span>
            )}
          </span>
        ))}
      </span>
    ),
  },
  { key: 'cost', header: 'Cost', align: 'right', render: (step) => <PriceTag copper={step.cost} /> },
]

const SHOPPING_COLUMNS: Column<LevelMaterial>[] = [
  {
    key: 'item',
    header: 'Item',
    render: (material) => <MaterialName material={material} />,
    sortValue: (material) => material.name,
  },
  {
    key: 'source',
    header: 'Buy from',
    render: (material) => <span className="text-zinc-400">{material.vendor ? 'Vendor' : 'Auction house'}</span>,
    sortValue: (material) => (material.vendor ? 'Vendor' : 'Auction house'),
  },
  {
    key: 'quantity',
    header: 'Quantity',
    align: 'right',
    render: (material) => formatNumber(material.quantity),
    sortValue: (material) => material.quantity,
  },
  {
    key: 'each',
    header: 'Average each',
    align: 'right',
    render: (material) => <PriceTag copper={Math.round(material.cost / material.quantity)} />,
    sortValue: (material) => material.cost / material.quantity,
  },
  {
    key: 'cost',
    header: 'Cost',
    align: 'right',
    render: (material) => (
      <>
        <PriceTag copper={material.cost} />
        {material.estimated && <span className="text-zinc-500">*</span>}
      </>
    ),
    sortValue: (material) => material.cost,
  },
]

// Auction items link to their page; vendor items have none.
function MaterialName({ material }: { material: LevelMaterial }) {
  if (material.vendor) return <span className="text-zinc-400">{material.name}</span>
  return (
    <Link to={`/item/${material.itemId}`} className="text-zinc-100 hover:underline">
      {material.name}
    </Link>
  )
}

function Tile({ label, partial, children }: { label: string; partial: boolean; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="tabular mt-0.5 text-base text-zinc-100">{children}</div>
      {partial && <div className="text-[11px] text-amber-400">incomplete</div>}
    </div>
  )
}
