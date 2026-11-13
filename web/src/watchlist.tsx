import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { watchApi, type Direction, type Watch } from './api.ts'
import { PriceTag } from './components/PriceTag.tsx'
import { toCoins } from './format.ts'

// Watchlist pieces shared by the Watchlist page, the item page and the header.

// One shared query, so one cached copy to refresh after a change.
const WATCHLIST_KEY = ['watchlist']

export function useWatchlist() {
  return useQuery({ queryKey: WATCHLIST_KEY, queryFn: watchApi.list, refetchInterval: 60_000 })
}

// Invalidating after a change makes everything showing the watchlist re-fetch.
export function useSaveWatch() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: watchApi.save,
    onSuccess: () => client.invalidateQueries({ queryKey: WATCHLIST_KEY }),
  })
}

export function useRemoveWatch() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: watchApi.remove,
    onSuccess: () => client.invalidateQueries({ queryKey: WATCHLIST_KEY }),
  })
}

export function RuleText({ direction, threshold }: { direction: Direction; threshold: number }) {
  return (
    <span className="whitespace-nowrap">
      <PriceTag copper={threshold} /> {direction === 'below' ? 'or less' : 'or more'}
    </span>
  )
}

const inputStyle =
  'rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none'

interface WatchFormProps {
  itemId: number
  currentMin: number | null
  existing: Watch[] // this item's rules, to pre-fill the form
}

// The alert form on an item's page. Gold, silver and copper become one copper amount.
export function WatchForm({ itemId, currentMin, existing }: WatchFormProps) {
  const save = useSaveWatch()
  const [direction, setDirection] = useState<Direction>('below')

  // Start from the saved rule for this direction, or else the current price.
  const startingPrice = (which: Direction) =>
    toCoins(existing.find((w) => w.direction === which)?.threshold ?? currentMin ?? 0)
  const [coins, setCoins] = useState(() => startingPrice('below'))

  const threshold = coins.gold * 10_000 + coins.silver * 100 + coins.copper
  const replacing = existing.some((w) => w.direction === direction)

  function changeDirection(next: Direction) {
    setDirection(next)
    setCoins(startingPrice(next))
  }

  function submit(event: FormEvent) {
    event.preventDefault() // stop the browser's own form submit (a page reload)
    if (threshold > 0) save.mutate({ itemId, direction, threshold })
  }

  // Invalid input becomes 0, so the total is always a valid amount.
  const coinBox = (part: 'gold' | 'silver' | 'copper', max: number, tint: string) => (
    <label className="flex items-center gap-1">
      <input
        type="number"
        min={0}
        max={max}
        value={coins[part]}
        onChange={(event) => {
          const value = Math.min(max, Math.max(0, Math.floor(Number(event.target.value) || 0)))
          setCoins({ ...coins, [part]: value })
        }}
        aria-label={part}
        className={`${inputStyle} tabular w-20 text-right`}
      />
      <span className={tint}>{part[0]}</span>
    </label>
  )

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-300">
        <span>Alert me when the cheapest listing</span>
        <select
          value={direction}
          onChange={(event) => changeDirection(event.target.value as Direction)}
          aria-label="direction"
          className={inputStyle}
        >
          <option value="below">drops to</option>
          <option value="above">rises to</option>
        </select>
        {coinBox('gold', 999_999, 'text-amber-400')}
        {coinBox('silver', 99, 'text-zinc-400')}
        {coinBox('copper', 99, 'text-orange-500')}
        <span>{direction === 'below' ? 'or less' : 'or more'}</span>
        <button
          type="submit"
          disabled={threshold <= 0 || save.isPending}
          className="rounded-md bg-amber-500 px-3 py-1 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-40"
        >
          {save.isPending ? 'Saving…' : replacing ? 'Update alert' : 'Add alert'}
        </button>
      </div>
      {save.isError && <p className="text-sm text-red-400">{save.error.message}</p>}
    </form>
  )
}

export function WatchStatus({ watch }: { watch: Watch }) {
  if (watch.triggeredAt !== null) {
    return <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-300">Triggered</span>
  }
  if (watch.currentMin === null) return <span className="text-xs text-zinc-500">Not listed</span>
  return <span className="text-xs text-zinc-500">Waiting</span>
}

export function RemoveButton({ id }: { id: number }) {
  const remove = useRemoveWatch()
  return (
    <button
      type="button"
      onClick={() => remove.mutate(id)}
      disabled={remove.isPending}
      className="rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-red-300 disabled:opacity-40"
    >
      Remove
    </button>
  )
}
