import { useQuery } from '@tanstack/react-query'
import { api } from '../api.ts'
import { formatDuration, formatNumber } from '../format.ts'

// The "last updated" line in the header. Re-checks every minute.
export function LastUpdated() {
  const { data } = useStatus()
  if (!data?.lastSnapshot) return null
  return (
    <span className="text-xs text-zinc-500" title={new Date(data.lastSnapshot.takenAt * 1000).toLocaleString()}>
      Prices from {formatDuration(data.lastSnapshot.ageSeconds)} ago ·{' '}
      {formatNumber(data.lastSnapshot.listingCount)} listings
    </span>
  )
}

// A warning across the top when the newest snapshot is over 2 hours old, so
// you never act on dead prices without knowing it.
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

// Both components above share one query: same key, so only one request.
function useStatus() {
  return useQuery({ queryKey: ['status'], queryFn: api.status, refetchInterval: 60_000 })
}
