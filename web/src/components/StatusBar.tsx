import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { api } from '../api.ts'
import { formatDuration, formatNumber } from '../format.ts'

// Blizzard publishes new prices about once an hour.
const SNAPSHOT_INTERVAL_SECONDS = 60 * 60
// Older than this and cheap listings have probably sold.
const GETTING_OLD_SECONDS = 40 * 60

export function LastUpdated() {
  const { data } = useStatus()
  if (!data?.lastSnapshot) return null
  const age = data.lastSnapshot.ageSeconds
  const untilNext = SNAPSHOT_INTERVAL_SECONDS - age
  return (
    <span
      className={age >= GETTING_OLD_SECONDS ? 'text-xs text-amber-400' : 'text-xs text-zinc-500'}
      title={`${new Date(data.lastSnapshot.takenAt * 1000).toLocaleString()} · ${formatNumber(data.lastSnapshot.listingCount)} listings`}
    >
      Prices from {formatDuration(age)} ago ·{' '}
      {untilNext > 60 ? `new prices in about ${formatDuration(untilNext)}` : 'new prices due'}
    </span>
  )
}

// A warning when the newest snapshot is over 2 hours old.
export function StaleBanner() {
  const { data } = useStatus()
  if (!data?.stale) return null
  return (
    <div className="border-b border-amber-800 bg-amber-950 px-4 py-2 text-center text-sm text-amber-200">
      {data.lastSnapshot
        ? `Prices are ${formatDuration(data.lastSnapshot.ageSeconds)} old - the collector may be down.`
        : 'No snapshot has been collected yet.'}
      {data.lastFailure && <span className="ml-2 text-amber-200/70">Last error: {data.lastFailure.error}</span>}
    </div>
  )
}

// Reloads every tab's data as soon as a new snapshot is in, so no page shows
// older prices than the header says. Renders nothing.
export function RefreshOnNewSnapshot() {
  const client = useQueryClient()
  const takenAt = useStatus().data?.lastSnapshot?.takenAt
  const previous = useRef(takenAt)
  useEffect(() => {
    if (takenAt !== undefined && previous.current !== undefined && takenAt !== previous.current) {
      void client.invalidateQueries({ predicate: (query) => query.queryKey[0] !== 'status' })
    }
    previous.current = takenAt
  }, [takenAt, client])
  return null
}

// Same query key, so every component shares one request.
function useStatus() {
  return useQuery({ queryKey: ['status'], queryFn: api.status, refetchInterval: 60_000 })
}
