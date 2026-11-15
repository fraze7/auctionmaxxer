import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { craftsApi, type Craft } from '../api.ts'
import { DataTable, type Column } from '../components/DataTable.tsx'
import { PriceTag } from '../components/PriceTag.tsx'
import { SellRate } from '../components/SellRate.tsx'
import { SELL_RATE_HINT } from '../sellRate.ts'
import { EmptyState, ErrorState, LoadingState } from '../components/States.tsx'
import { formatNumber } from '../format.ts'
import { useSkills } from '../profile.ts'
import { useUrlParam } from '../useUrlParam.ts'

// Recipes whose product sells for more than its materials cost. Worked out on
// the server (server/src/crafts.ts).

export function CraftsPage() {
  const [profession, setProfession] = useUrlParam('profession')
  const [show, setShow] = useUrlParam('show')
  const crafts = useQuery({
    queryKey: ['crafts'],
    queryFn: () => craftsApi.list({}),
    refetchInterval: 5 * 60_000,
  })

  // With a saved character, only what it can make is shown unless asked otherwise.
  const skills = useSkills()
  const [everyone, setEveryone] = useUrlParam('everyone')
  const hasCrafting = (crafts.data?.professions ?? []).some((p) => skills.has(p.id))
  const onlyMine = hasCrafting && everyone !== '1'
  const canMake = (craft: Craft) => (skills.get(craft.profession.id) ?? 0) >= craft.skill

  const options = [{ id: '', name: 'All' }, ...(crafts.data?.professions ?? [])]
  const rows = (crafts.data?.crafts ?? []).filter(
    (craft) =>
      (profession === '' || craft.profession.id === profession) &&
      (show === 'all' || craft.profit > 0) &&
      (!onlyMine || canMake(craft)),
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">Crafts</h1>
          <p className="text-sm text-zinc-500">
            What a craft sells for against what its materials cost, at the cheapest prices listed right now.
          </p>
        </div>

        <div className="flex rounded-md border border-zinc-700 text-sm">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={profession === option.id}
              onClick={() => setProfession(option.id)}
              className={[
                'px-3 py-1.5 first:rounded-l-md last:rounded-r-md',
                profession === option.id ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-100',
              ].join(' ')}
            >
              {option.name}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <label className="flex items-center gap-2 pb-1.5 text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={show === 'all'}
            onChange={(event) => setShow(event.target.checked ? 'all' : '')}
            className="accent-amber-500"
          />
          Show crafts that lose money too
        </label>
        {hasCrafting && (
          <label className="flex items-center gap-2 pb-1.5 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={onlyMine}
              onChange={(event) => setEveryone(event.target.checked ? '' : '1')}
              className="accent-amber-500"
            />
            Only what my character can make
          </label>
        )}
      </div>

      {crafts.isPending ? (
        <LoadingState />
      ) : crafts.isError ? (
        <ErrorState error={crafts.error} />
      ) : rows.length === 0 ? (
        <EmptyState title="Nothing profitable right now">
          <p>No tracked recipe sells for more than its materials at current prices.</p>
        </EmptyState>
      ) : (
        <>
          <DataTable
            rows={rows}
            columns={COLUMNS}
            rowKey={(craft) => `${craft.profession.id}-${craft.spellId}`}
            initialSort={{ key: 'profit', direction: 'desc' }}
          />
          <p className="text-xs text-zinc-500">
            Cost, Sells for and Profit are for one craft, after the auction house keeps{' '}
            {Math.round(crafts.data.ahCut * 100)}% of the sale. Each extra craft buys dearer materials, and the sale
            price will not hold if you flood the market. Materials marked &ldquo;made&rdquo; are cheaper to craft from
            their own inputs than to buy. Only products sold in stacks are tracked, so crafted gear is not listed.
            &ldquo;Sells&rdquo; is a rough estimate from cheap listings disappearing between hourly snapshots: fast is
            100 or more a day, steady 10 or more, slow fewer.
          </p>
        </>
      )}
    </div>
  )
}

const COLUMNS: Column<Craft>[] = [
  {
    key: 'craft',
    header: 'Craft',
    render: (craft) => (
      <span className="whitespace-nowrap">
        <Link to={`/item/${craft.productId}`} className="text-zinc-100 hover:underline">
          {craft.name}
        </Link>
        {craft.makes > 1 && <span className="tabular text-zinc-500"> ×{formatNumber(craft.makes)}</span>}
        {craft.plan && (
          <span className="ml-1.5 rounded border border-zinc-700 px-1 text-[11px] text-zinc-400">plan</span>
        )}
        <div className="text-xs text-zinc-500">
          {craft.profession.name} {craft.skill}
        </div>
      </span>
    ),
    sortValue: (craft) => craft.name,
  },
  {
    key: 'materials',
    header: 'Materials',
    render: (craft) => (
      <span className="text-zinc-300">
        {craft.materials.map((material, index) => (
          <span key={material.itemId}>
            {index > 0 && ', '}
            <span className="tabular">{formatNumber(material.quantity)}</span>{' '}
            {material.source === 'vendor' ? (
              <span className="text-zinc-400">{material.name}</span>
            ) : (
              <Link to={`/item/${material.itemId}`} className="text-zinc-100 hover:underline">
                {material.name}
              </Link>
            )}
            {material.source === 'crafted' && <span className="text-zinc-500"> (made)</span>}
          </span>
        ))}
      </span>
    ),
  },
  {
    key: 'cost',
    header: 'Cost',
    align: 'right',
    render: (craft) => <PriceTag copper={craft.cost} />,
    sortValue: (craft) => craft.cost,
  },
  {
    key: 'sale',
    header: 'Sells for',
    align: 'right',
    render: (craft) => (
      <Link to={`/item/${craft.productId}`} className="hover:underline">
        <PriceTag copper={craft.sale} />
      </Link>
    ),
    sortValue: (craft) => craft.sale,
  },
  {
    key: 'profit',
    header: 'Profit',
    align: 'right',
    render: (craft) =>
      craft.profit >= 0 ? (
        <PriceTag copper={craft.profit} />
      ) : (
        <span className="text-red-400">
          −<PriceTag copper={-craft.profit} />
        </span>
      ),
    sortValue: (craft) => craft.profit,
  },
  {
    key: 'margin',
    header: 'Margin',
    align: 'right',
    render: (craft) => (craft.cost > 0 ? `${Math.round((craft.profit / craft.cost) * 100)}%` : '–'),
    sortValue: (craft) => (craft.cost > 0 ? craft.profit / craft.cost : 0),
  },
  {
    key: 'soldPerDay',
    header: 'Sells',
    title: SELL_RATE_HINT,
    align: 'right',
    render: (craft) => <SellRate soldPerDay={craft.soldPerDay} />,
    sortValue: (craft) => craft.soldPerDay ?? -1,
  },
  {
    key: 'listed',
    header: 'On sale',
    align: 'right',
    render: (craft) => formatNumber(craft.listed),
    sortValue: (craft) => craft.listed,
  },
]
