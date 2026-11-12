// Small pure helpers for turning raw numbers into text. No React in here.

export interface Coins {
  negative: boolean
  gold: number
  silver: number
  copper: number
}

// 123456 copper -> 12 gold, 34 silver, 56 copper. (1g = 100s = 10,000c)
export function toCoins(totalCopper: number): Coins {
  const abs = Math.abs(Math.round(totalCopper))
  return {
    negative: totalCopper < 0,
    gold: Math.floor(abs / 10_000),
    silver: Math.floor((abs % 10_000) / 100),
    copper: abs % 100,
  }
}

// "5 min", "3 h", "2 d" - how long a number of seconds is, roughly.
export function formatDuration(seconds: number): string {
  if (seconds < 90) return 'a minute'
  if (seconds < 90 * 60) return `${Math.round(seconds / 60)} min`
  if (seconds < 36 * 3600) return `${Math.round(seconds / 3600)} h`
  return `${Math.round(seconds / 86_400)} d`
}

// 12345 -> "12,345"
export function formatNumber(value: number): string {
  return value.toLocaleString('en-GB')
}

// 0.7 -> "-30%", 1.2 -> "+20%": how far the last day sits from the week.
export function formatTrend(ratio: number): string {
  const percent = Math.round((ratio - 1) * 100)
  return `${percent > 0 ? '+' : ''}${percent}%`
}
