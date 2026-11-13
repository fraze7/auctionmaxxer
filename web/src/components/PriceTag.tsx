import { toCoins } from '../format.ts'

// A copper amount as the game shows it: 12g 34s 56c, leading zero parts dropped.
export function PriceTag({ copper }: { copper: number }) {
  const coins = toCoins(copper)
  const showGold = coins.gold > 0
  const showSilver = showGold || coins.silver > 0

  return (
    <span className="tabular whitespace-nowrap">
      {coins.negative && '-'}
      {showGold && (
        <>
          {coins.gold.toLocaleString('en-GB')}
          <span className="text-amber-400">g</span>{' '}
        </>
      )}
      {showSilver && (
        <>
          {coins.silver}
          <span className="text-zinc-400">s</span>{' '}
        </>
      )}
      {coins.copper}
      <span className="text-orange-500">c</span>
    </span>
  )
}
