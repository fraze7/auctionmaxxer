import { formatNumber } from '../format.ts'

// How fast an item sells, as a band. The number behind it is a rough estimate
// (see server/src/liquidity.ts), so it only shows on hover.

const BANDS = [
  { atLeast: 100, label: 'fast', style: 'text-green-400' },
  { atLeast: 10, label: 'steady', style: 'text-zinc-200' },
  { atLeast: 0.5, label: 'slow', style: 'text-amber-400' },
  { atLeast: 0, label: 'none seen', style: 'text-zinc-500' },
] as const

export function SellRate({ soldPerDay }: { soldPerDay: number | null }) {
  if (soldPerDay === null) return <span className="text-zinc-600">–</span>
  const band = BANDS.find((candidate) => soldPerDay >= candidate.atLeast) ?? BANDS[BANDS.length - 1]!
  return (
    <span className={band.style} title={`About ${formatNumber(Math.round(soldPerDay))} a day, as a rough estimate`}>
      {band.label}
    </span>
  )
}
