import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { craftsApi, type Craft } from '../api.ts'
import { DataTable, type Column } from '../components/DataTable.tsx'
import { PriceTag } from '../components/PriceTag.tsx'
import { SellRate } from '../components/SellRate.tsx'
import { SELL_RATE_HINT } from '../sellRate.ts'
import { EmptyState, ErrorState, LoadingState } from '../components/States.tsx'
import { formatNumber } from '../format.ts'
import { useSkills } from '../profile.ts'
import { toWholeNumber, useUrlParam } from '../useUrlParam.ts'

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

  // Per craft, in silver; empty = no minimum.
  const [minProfitText, setMinProfitText] = useUrlParam('profit')
  const minProfit = (toWholeNumber(minProfitText) ?? 0) * 100

  // With a saved character, only what it can make is shown unless asked otherwise.
  const skills = useSkills()
  const [everyone, setEveryone] = useUrlParam('everyone')
  const hasCrafting = (crafts.data?.professions ?? []).some((p) => skills.has(p.id))
  const onlyMine = hasCrafting && everyone !== '1'
  const canMake = (craft: Craft) => (skills.get(craft.profession.id) ?? 0) >= craft.skill

  // Stackable products (the default) or gear.
  const [kindText, setKind] = useUrlParam('kind')
  const kind = kindText === 'gear' ? 'gear' : 'stack'

  const options = [{ id: '', name: 'All' }, ...(crafts.data?.professions ?? [])]
  const rows = (crafts.data?.crafts ?? []).filter(
    (craft) =>
      (profession === '' || craft.profession.id === profession) &&
      craft.kind === kind &&
      (minProfit > 0 ? craft.profit >= minProfit : show === 'all' || craft.profit > 0) &&
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
        <div className="flex rounded-md border border-zinc-700 text-sm">
          {KINDS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={kind === option.id}
              onClick={() => setKind(option.id === 'stack' ? '' : option.id)}
              className={[
                'px-3 py-1.5 first:rounded-l-md last:rounded-r-md',
                kind === option.id ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-100',
              ].join(' ')}
            >
              {option.name}
            </button>
          ))}
        </div>
        <label className="block text-xs text-zinc-400">
          Profit of at least (silver)
          <input
            type="text"
            inputMode="numeric"
            value={minProfitText}
            placeholder="any"
            onChange={(event) => setMinProfitText(event.target.value.replace(/\D/g, '').slice(0, 6))}
            className="tabular mt-1 block w-24 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none"
          />
        </label>
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
          <p>No tracked recipe clears its materials by that much at current prices.</p>
        </EmptyState>
      ) : (
        <>
          <DataTable
            rows={rows}
            columns={COLUMNS}
            rowKey={(craft) => `${craft.profession.id}-${craft.spellId}`}
            initialSort={{ key: 'margin', direction: 'desc' }}
          />
          <p className="text-xs text-zinc-500">
            Cost, Sells for and Profit are for one craft, after the auction house keeps{' '}
            {Math.round(crafts.data.ahCut * 100)}% of the sale. Each extra craft buys dearer materials, and the sale
            price will not hold if you flood the market. Materials marked &ldquo;made&rdquo; are cheaper to craft from
            their own inputs than to buy. Where a vendor pays more than the auction house, the sale is to a vendor
            (&ldquo;to a vendor&rdquo;), which takes any number. Gear sells one at a time, so it is priced for a single craft at its cheapest
            listing, or at what a vendor pays if that is more. With fewer than three listed, the listings are ignored
            and gear is priced at the vendor.
            &ldquo;Sells&rdquo; is a rough estimate from cheap listings disappearing between hourly snapshots: fast is
            100 or more a day, steady 10 or more, slow fewer.
          </p>
        </>
      )}
    </div>
  )
}

const KINDS = [
  { id: 'stack', name: 'Stackable' },
  { id: 'gear', name: 'Gear' },
]

// Gear has no price history on the site, so it links to Wowhead instead.
function ProductLink({ craft, className, children }: { craft: Craft; className: string; children: ReactNode }) {
  if (craft.kind === 'stack') {
    return (
      <Link to={`/item/${craft.productId}`} className={className}>
        {children}
      </Link>
    )
  }
  return (
    <a
      href={`https://www.wowhead.com/forever/item=${craft.productId}`}
      target="_blank"
      rel="noreferrer"
      className={className}
    >
      {children}
    </a>
  )
}

const COLUMNS: Column<Craft>[] = [
  {
    key: 'craft',
    header: 'Craft',
    render: (craft) => (
      <span className="whitespace-nowrap">
        <ProductLink craft={craft} className="text-zinc-100 hover:underline">
          {craft.name}
        </ProductLink>
        {craft.kind === 'gear' && (
          <span className="ml-1.5 rounded border border-zinc-700 px-1 text-[11px] text-zinc-400">gear</span>
        )}
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
      <span className="whitespace-nowrap">
        <ProductLink craft={craft} className="hover:underline">
          <PriceTag copper={craft.sale} />
        </ProductLink>
        {craft.saleTo === 'vendor' && (
          <span className="block text-xs text-zinc-500">
            to a vendor{craft.kind === 'gear' && craft.listed > 0 && craft.listed < 3 && ` (${craft.listed} listed)`}
          </span>
        )}
      </span>
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
