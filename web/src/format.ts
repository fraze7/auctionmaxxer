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

// A short price for chart axes, where "1g 23s 45c" would not fit:
// 45 -> "45c", 2345 -> "23s", 123456 -> "12g", 15000 -> "1.5g".
export function formatCopperShort(copper: number): string {
  if (copper >= 10_000) {
    const gold = copper / 10_000
    return `${gold < 10 && gold % 1 !== 0 ? gold.toFixed(1) : Math.round(gold)}g`
  }
  if (copper >= 100) {
    const silver = copper / 100
    return `${silver < 10 && silver % 1 !== 0 ? silver.toFixed(1) : Math.round(silver)}s`
  }
  return `${Math.round(copper)}c`
}

// 12345 -> "12k", for chart axes.
export function formatCountShort(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`
  if (value >= 10_000) return `${Math.round(value / 1000)}k`
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`
  return String(Math.round(value))
}

// A snapshot time in the viewer's own time zone: "Thu 12 Nov, 22:25".
export function formatDateTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
