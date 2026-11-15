// Wording shared by the pages that show how fast an item sells.

export const SELL_RATE_HINT =
  'Estimated from cheap listings disappearing between hourly snapshots. Fast is 100 or more a day, steady 10 or more, slow fewer.'

// How long `units` would take to sell at that rate, in words.
export function stockToSell(units: number, soldPerDay: number): string {
  if (soldPerDay <= 0) return 'none seen selling'
  const days = units / soldPerDay
  if (days < 1) return 'under a day of stock'
  if (days < 7) return 'a few days of stock'
  if (days < 30) return 'weeks of stock'
  return 'over a month of stock'
}
