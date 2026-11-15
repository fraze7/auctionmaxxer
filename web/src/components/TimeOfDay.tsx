import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { itemApi, type HourOfDay } from '../api.ts'
import { SERIES_COLOR } from './HistoryChart.tsx'

// The cheapest price by hour of day, against the typical price of the same
// day. Worked out on the server (server/src/hours.ts) in UTC; shown in the
// browser's own time zone. Bars point up for dearer and down for cheaper.

const PLOT_HEIGHT = 112 // px, half above the line and half below
// The scale never zooms in closer than this, so noise does not fill the plot.
const MIN_SCALE = 0.05
// Under this swing either way there is nothing worth acting on.
const FLAT = 0.03

interface LocalHour extends HourOfDay {
  local: number // hour of day in the browser's time zone
  ratio: number
}

const clock = (hour: number) => `${String(hour).padStart(2, '0')}:00`
const percent = (ratio: number) => `${Math.abs(Math.round((ratio - 1) * 100))}%`
const describe = (ratio: number) =>
  Math.round((ratio - 1) * 100) === 0 ? 'about typical' : `${percent(ratio)} ${ratio > 1 ? 'dearer' : 'cheaper'}`

// Today's date, so daylight saving is the one in force now.
function localHour(utcHour: number): number {
  const today = new Date()
  return new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate(), utcHour)).getHours()
}

export function TimeOfDay({ id }: { id: number }) {
  const pattern = useQuery({ queryKey: ['item-hours', id], queryFn: () => itemApi.hours(id) })
  const [hovered, setHovered] = useState<number | null>(null)

  if (pattern.isPending) return <p className="text-sm text-zinc-500">Loading…</p>
  if (pattern.isError) return <p className="text-sm text-red-400">{pattern.error.message}</p>
  if (!pattern.data.ready) {
    return (
      <p className="text-sm text-zinc-500">
        This needs each hour of the day to have been seen on five days, with prices listed. There are{' '}
        {pattern.data.days.toFixed(1)} days of history for this item so far.
      </p>
    )
  }

  const hours: LocalHour[] = pattern.data.hours
    .map((entry) => ({
      ...entry,
      ratio: entry.ratio ?? 1,
      local: localHour(entry.hour),
    }))
    .sort((a, b) => a.local - b.local)

  const cheapest = hours.reduce((a, b) => (b.ratio < a.ratio ? b : a))
  const dearest = hours.reduce((a, b) => (b.ratio > a.ratio ? b : a))
  const scale = Math.max(MIN_SCALE, ...hours.map((entry) => Math.abs(entry.ratio - 1)))
  const flat = 1 - cheapest.ratio < FLAT && dearest.ratio - 1 < FLAT
  const shown = hours.find((entry) => entry.local === hovered)

  return (
    <div>
      <p className="text-sm text-zinc-300">
        {flat ? (
          'No clear daily pattern: the price stays within 3% of its typical level at every hour.'
        ) : (
          <>
            Usually cheapest around <span className="tabular text-zinc-100">{clock(cheapest.local)}</span> (
            {percent(cheapest.ratio)} below typical) and dearest around{' '}
            <span className="tabular text-zinc-100">{clock(dearest.local)}</span> ({percent(dearest.ratio)} above
            typical).
          </>
        )}
      </p>

      <div className="mt-4 flex gap-0.5" style={{ height: PLOT_HEIGHT }} onMouseLeave={() => setHovered(null)}>
        {hours.map((entry) => {
          const size = (Math.abs(entry.ratio - 1) / scale) * (PLOT_HEIGHT / 2)
          const up = entry.ratio >= 1
          const marked = !flat && (entry === cheapest || entry === dearest)
          return (
            // The whole column is the hover target, not just the bar.
            <div
              key={entry.local}
              className="relative flex-1"
              onMouseEnter={() => setHovered(entry.local)}
              aria-label={`${clock(entry.local)}: ${describe(entry.ratio)}`}
            >
              <div className="absolute inset-x-0 top-1/2 h-px bg-zinc-700" />
              <div
                className={['absolute inset-x-0', up ? 'rounded-t' : 'rounded-b'].join(' ')}
                style={{
                  height: Math.max(size, 1),
                  backgroundColor: SERIES_COLOR.min,
                  opacity: hovered === null || hovered === entry.local ? 1 : 0.45,
                  ...(up ? { bottom: '50%' } : { top: '50%' }),
                }}
              />
              {marked && (
                <span
                  className="tabular absolute left-1/2 -translate-x-1/2 text-[11px] whitespace-nowrap text-zinc-300"
                  style={up ? { bottom: `calc(50% + ${size + 2}px)` } : { top: `calc(50% + ${size + 2}px)` }}
                >
                  {up ? '+' : '−'}
                  {percent(entry.ratio)}
                </span>
              )}
            </div>
          )
        })}
      </div>
      <div className="mt-1 flex gap-0.5 text-[11px] text-zinc-500">
        {hours.map((entry) => (
          <span key={entry.local} className="tabular flex-1 text-center">
            {entry.local % 3 === 0 ? String(entry.local).padStart(2, '0') : ''}
          </span>
        ))}
      </div>

      <p className="mt-3 text-xs text-zinc-500">
        {shown ? (
          <span className="text-zinc-300">
            {clock(shown.local)}: {describe(shown.ratio)}
            {describe(shown.ratio) === 'about typical' ? ' for' : ' than the typical price of'} the same day, from{' '}
            {shown.samples} days.
          </span>
        ) : (
          <>
            Hours are in your own time zone. Each bar is the middle value over {pattern.data.days.toFixed(0)} days of
            hourly snapshots, so with only a few days it can be thrown by one unusual day.
          </>
        )}
      </p>
    </div>
  )
}
