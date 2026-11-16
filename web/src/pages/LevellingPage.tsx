import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { levellingApi, type LevelMaterial, type LevellingResponse, type LevelStep } from '../api.ts'
import { DataTable, type Column } from '../components/DataTable.tsx'
import { PriceTag } from '../components/PriceTag.tsx'
import { EmptyState, ErrorState, LoadingState } from '../components/States.tsx'
import { formatNumber } from '../format.ts'
import { useSkills } from '../profile.ts'
import { toWholeNumber, useUrlParam } from '../useUrlParam.ts'

// The cheapest way to level a profession at current prices. The route is
// worked out on the server (server/src/levelling.ts).

const PROFESSION_IDS = ['alchemy', 'blacksmithing', 'tailoring', 'leatherworking', 'engineering', 'enchanting']

export function LevellingPage() {
  // The saved character sets the defaults; the URL overrides them.
  const skills = useSkills()
  const [chosen, setChosen] = useUrlParam('profession')
  const mine = PROFESSION_IDS.find((id) => skills.has(id))
  const profession = PROFESSION_IDS.includes(chosen) ? chosen : (mine ?? 'alchemy')

  // Skill in the helper profession (Mining for Blacksmithing). Empty = as saved; 0 = not trained.
  const [helperText, setHelperText] = useUrlParam('helper')
  const helperSkill = Math.min(toWholeNumber(helperText) ?? skills.get('mining') ?? 0, 300)

  // Start from the character's skill unless the whole route is asked for.
  const [whole, setWhole] = useUrlParam('whole')
  const mySkill = skills.get(profession)
  const canStartFromMine = mySkill !== undefined && mySkill > 1 && mySkill < 300
  const from = canStartFromMine && whole !== '1' ? mySkill : 1

  // Plans to leave out of the route, as spell IDs.
  const [skip] = useUrlParam('skip')

  const levelling = useQuery({
    queryKey: ['levelling', profession, helperSkill, from, skip],
    queryFn: () => levellingApi.get({ profession, helperSkill, from, ...(/^\d+(,\d+)*$/.test(skip) ? { skip } : {}) }),
    placeholderData: keepPreviousData,
    refetchInterval: 5 * 60_000,
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">Profession levelling</h1>
          <p className="text-sm text-zinc-500">
            The cheapest recipe for each skill point at current auction prices, using trainer recipes where possible.
          </p>
        </div>

        <div className="flex rounded-md border border-zinc-700 text-sm">
          {(levelling.data?.professions ?? []).map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={profession === option.id}
              onClick={() => setChosen(option.id)}
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

      {canStartFromMine && (
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={whole !== '1'}
            onChange={(event) => setWhole(event.target.checked ? '' : '1')}
            className="accent-amber-500"
          />
          Start from my skill ({mySkill})
        </label>
      )}

      {levelling.data?.helper && (
        <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-300">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={helperSkill > 0}
              onChange={(event) => setHelperText(event.target.checked ? String(skills.get('mining') ?? 300) : '0')}
              className="accent-amber-500"
            />
            I have {levelling.data.helper.name}
          </label>
          {helperSkill > 0 && (
            <label className="flex items-center gap-2 text-xs text-zinc-400">
              {levelling.data.helper.name} skill
              <input
                type="text"
                inputMode="numeric"
                value={helperText === '' ? String(helperSkill) : helperText}
                onChange={(event) => setHelperText(event.target.value.replace(/\D/g, '').slice(0, 3) || '0')}
                className="tabular w-16 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none"
              />
            </label>
          )}
          <span className="text-xs text-zinc-500">
            Bars are priced from ore when smelting them yourself is cheaper.
          </span>
        </div>
      )}

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

// What the route's bought plans add, counting each plan once.
function PlanCosts({ plan }: { plan: LevellingResponse }) {
  const plans = new Map(plan.steps.filter((step) => step.plan).map((step) => [step.spellId, step.planItem]))
  if (plans.size === 0) return null
  const priced = [...plans.values()].filter((item) => item?.price != null)
  const cost = priced.reduce((sum, item) => sum + (item?.price ?? 0), 0)
  const unknown = plans.size - priced.length
  return (
    <p className="text-sm text-zinc-400">
      {priced.length > 0 ? (
        <>
          The {priced.length === 1 ? 'plan' : `${priced.length} plans`} on sale for this route cost{' '}
          <span className="text-zinc-100">
            <PriceTag copper={cost} />
          </span>{' '}
          at their cheapest listings, on top of the materials.
        </>
      ) : (
        'None of the plans on this route has a price yet.'
      )}
      {unknown > 0 &&
        ` ${unknown} ${unknown === 1 ? 'plan has' : 'plans have'} no listing: sold by a vendor, from a quest, or not on the auction house right now.`}
    </p>
  )
}

// The plans left out of the route live in the URL as ?skip=id,id.
function useSkippedPlans(): [number[], (ids: number[]) => void] {
  const [skip, setSkip] = useUrlParam('skip')
  const ids = skip
    .split(',')
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0)
  return [ids, (next) => setSkip(next.join(','))]
}

// For a plan you do not have or that costs too much: plans the route again without it.
function SkipPlan({ spellId }: { spellId: number }) {
  const [ids, setIds] = useSkippedPlans()
  return (
    <button
      type="button"
      onClick={() => setIds([...ids, spellId])}
      title="Plan the route again without this plan"
      className="ml-1.5 text-[11px] text-zinc-500 underline decoration-dotted hover:text-zinc-200"
    >
      skip
    </button>
  )
}

function SkippedPlans({ plan }: { plan: LevellingResponse }) {
  const [ids, setIds] = useSkippedPlans()
  if (plan.skipped.length === 0 && plan.unavailable.length === 0) return null
  return (
    <>
      {plan.unavailable.length > 0 && (
        <p className="text-sm text-zinc-400">
          Left out because nobody has listed the plan in the last two weeks:{' '}
          <span className="text-zinc-200">{plan.unavailable.map((recipe) => recipe.name).join(', ')}</span>. They come
          back by themselves if one is listed.
        </p>
      )}
      {plan.skipped.length > 0 && <SkippedByHand plan={plan} ids={ids} setIds={setIds} />}
    </>
  )
}

function SkippedByHand(props: { plan: LevellingResponse; ids: number[]; setIds: (ids: number[]) => void }) {
  const { plan, ids, setIds } = props
  return (
    <p className="text-sm text-zinc-400">
      Left out:{' '}
      {plan.skipped.map((recipe, index) => (
        <span key={recipe.spellId}>
          {index > 0 && ', '}
          <span className="text-zinc-200">{recipe.name}</span>{' '}
          <button
            type="button"
            onClick={() => setIds(ids.filter((id) => id !== recipe.spellId))}
            className="text-xs text-zinc-500 underline decoration-dotted hover:text-zinc-200"
          >
            put back
          </button>
        </span>
      ))}
    </p>
  )
}

// The last stretch of a route is often most of its cost. Where a third of the
// total falls within the final LAST_POINTS, say what stopping short saves.
const LAST_POINTS = 25
const STEEP_SHARE = 1 / 3

function SteepEnding({ plan }: { plan: LevellingResponse }) {
  // Places to stop in the last stretch: where a step starts, or part-way through one.
  const candidates: Array<{ skill: number; tail: number }> = []
  let spent = 0
  for (const step of plan.steps) {
    candidates.push({ skill: step.from, tail: plan.totalCost - spent })
    for (const part of step.stops) candidates.push({ skill: part.skill, tail: plan.totalCost - spent - part.cost })
    spent += step.cost
  }
  // The shortest final stretch that holds at least a third of the cost.
  const stop = candidates
    .filter((c) => c.skill >= plan.reached - LAST_POINTS && c.skill > plan.from && c.skill < plan.reached)
    .filter((c) => c.tail >= plan.totalCost * STEEP_SHARE)
    .sort((a, b) => b.skill - a.skill)[0]
  if (!stop) return null

  return (
    <p className="text-sm text-zinc-400">
      The last {plan.reached - stop.skill} points cost <PriceTag copper={stop.tail} />. Stopping at skill{' '}
      <span className="tabular text-zinc-100">{stop.skill}</span> costs{' '}
      <span className="text-zinc-100">
        <PriceTag copper={plan.totalCost - stop.tail} />
      </span>
      .
    </p>
  )
}

// The server splits steps at 150 and 225 for the bracket totals; one recipe
// either side of a split reads better as one row.
function joinSplitSteps(steps: LevelStep[]): LevelStep[] {
  const joined: LevelStep[] = []
  for (const step of steps) {
    const last = joined.at(-1)
    if (!last || last.spellId !== step.spellId || last.to !== step.from) {
      joined.push(step)
      continue
    }
    const materials = last.materials.map((m) => ({ ...m }))
    for (const m of step.materials) {
      const same = materials.find((other) => other.itemId === m.itemId)
      if (!same) {
        materials.push(m)
        continue
      }
      same.quantity += m.quantity
      same.crafted += m.crafted
      same.cost += m.cost
      same.estimated ||= m.estimated
      if (same.via && m.via) {
        same.via = {
          name: same.via.name,
          quantity: same.via.quantity + m.via.quantity,
          saves: same.via.saves === null || m.via.saves === null ? null : same.via.saves + m.via.saves,
        }
      }
    }
    joined[joined.length - 1] = {
      ...last,
      to: step.to,
      crafts: last.crafts + step.crafts,
      guaranteed: last.guaranteed && step.guaranteed,
      materials,
      cost: last.cost + step.cost,
      stops: [
        ...last.stops,
        { skill: last.to, cost: last.cost },
        ...step.stops.map((stop) => ({ skill: stop.skill, cost: last.cost + stop.cost })),
      ],
    }
  }
  return joined
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
          {plan.tooDear
            ? `The route stops at skill ${plan.reached}: the only recipes the auction house can supply from there cost over ten times more per point.`
            : `The auction house runs out of materials at skill ${plan.reached}.`}{' '}
          The costs below only cover {plan.from} to {plan.reached}.
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

      <SteepEnding plan={plan} />
      <SkippedPlans plan={plan} />
      <PlanCosts plan={plan} />

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-zinc-100">Steps</h2>
        <DataTable rows={joinSplitSteps(plan.steps)} columns={STEP_COLUMNS} rowKey={(step) => step.from} />
        <p className="text-xs text-zinc-500">
          Crafts marked ~ are an average: those recipes no longer give a point every time, so you may need a few more or
          fewer. Trainer fees are not included, and nothing is deducted for selling what you make.
          {plan.steps.some((step) => step.plan) &&
            ' Recipes marked "plan" are learned from plans bought from a vendor or the auction house, or earned from a quest, not from a trainer; what the plan costs is not included.'}
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
        {step.plan && (
          <>
            <span className="ml-1.5 rounded border border-zinc-700 px-1 text-[11px] text-zinc-400">plan</span>
            <SkipPlan spellId={step.spellId} />
            {step.planItem && (
              <span className="block text-xs text-zinc-500">
                {step.planItem.price === null ? (
                  'plan not on the auction house right now'
                ) : (
                  <>
                    plan from <PriceTag copper={step.planItem.price} /> ({formatNumber(step.planItem.listed)} listed)
                  </>
                )}
              </span>
            )}
          </>
        )}
      </span>
    ),
  },
  {
    key: 'materials',
    header: 'Materials',
    render: (step) => (
      <span className="text-zinc-300">
        {step.materials.map((material, index) => (
          <span key={index}>
            {index > 0 && ', '}
            <span className="tabular">{formatNumber(material.quantity)}</span> <MaterialName material={material} />
            {material.crafted > 0 && (
              <span className="text-zinc-500"> ({formatNumber(material.crafted)} made earlier)</span>
            )}
            {material.via && (
              <span className="text-zinc-500">
                {' '}
                (for {formatNumber(material.via.quantity)} {material.via.name}
                {/* The saving is for the whole reagent, so it shows once, on its first input. */}
                {step.materials[index - 1]?.via?.name !== material.via.name &&
                  (material.via.saves === null ? (
                    ', too few on sale to buy'
                  ) : (
                    <>
                      , <PriceTag copper={material.via.saves} /> cheaper than buying them
                    </>
                  ))}
                )
              </span>
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
