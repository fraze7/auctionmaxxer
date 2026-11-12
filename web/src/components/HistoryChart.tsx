import type { ReactNode } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { HistoryPoint } from '../api.ts'
import { formatDateTime } from '../format.ts'

// A line chart over an item's snapshot history. The item page uses it three
// times: once for prices (two lines) and once each for quantity and listings.
//
// Design rules it follows:
//   * One y-axis per chart. Prices and quantities are different units, so
//     they get separate charts rather than two scales squeezed into one.
//   * Each line has a fixed colour that means the same thing everywhere.
//   * Grid and axes are faint; the data is what stands out.
//   * Hovering shows a crosshair and the exact values at that snapshot.

// Colours picked from a palette checked for colour-blind separation and for
// contrast against this dark background.
export const SERIES_COLOR = {
  min: '#3987e5', // blue
  median: '#d95926', // orange
  supply: '#199e70', // aqua
} as const

const AXIS_COLOR = '#71717a' // zinc-500
const GRID_COLOR = '#27272a' // zinc-800
const HOUR = 3600

export interface Series {
  key: keyof HistoryPoint
  label: string
  color: string
}

interface Props {
  points: HistoryPoint[]
  series: Series[]
  height: number
  formatAxis: (value: number) => string // short form for the y-axis ticks
  renderValue: (value: number) => ReactNode // full form for the tooltip
}

export function HistoryChart({ points, series, height, formatAxis, renderValue }: Props) {
  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last) return null

  // Under two days of data: label the x-axis with times. Otherwise with dates.
  const spanHours = (last.takenAt - first.takenAt) / HOUR
  const formatTick = (unixSeconds: number) => {
    const date = new Date(unixSeconds * 1000)
    return spanHours <= 48
      ? date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
      : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  }

  // With only a handful of points a bare line is hard to read (and one point
  // draws nothing at all), so mark each point until the chart fills up.
  const showDots = points.length <= 36

  return (
    <div>
      {/* A legend only when there is more than one line to tell apart. */}
      {series.length > 1 && (
        <div className="mb-2 flex gap-4 text-xs text-zinc-400">
          {series.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4 rounded" style={{ backgroundColor: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}

      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={GRID_COLOR} vertical={false} />
          <XAxis
            dataKey="takenAt"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            tickFormatter={formatTick}
            tick={{ fill: AXIS_COLOR, fontSize: 11 }}
            stroke={GRID_COLOR}
            tickLine={false}
            minTickGap={48}
          />
          <YAxis
            tickFormatter={formatAxis}
            tick={{ fill: AXIS_COLOR, fontSize: 11 }}
            stroke={GRID_COLOR}
            tickLine={false}
            axisLine={false}
            width={48}
            // Start a little below the lowest value instead of at zero: price
            // moves of a few percent are the whole point and would otherwise
            // be flattened. The axis labels make the range explicit.
            domain={['auto', 'auto']}
          />
          <Tooltip
            cursor={{ stroke: AXIS_COLOR, strokeDasharray: '3 3' }}
            isAnimationActive={false}
            content={(props) => (
              <ChartTooltip point={hoveredPoint(props)} series={series} renderValue={renderValue} />
            )}
          />
          {series.map((s) => (
            <Line
              key={s.key}
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              // Straight segments between snapshots: we don't know what the
              // price did in between, so we don't draw a curve implying we do.
              type="linear"
              dot={showDots ? { r: 3, fill: s.color, strokeWidth: 0 } : false}
              activeDot={{ r: 5, stroke: '#09090b', strokeWidth: 2 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// Recharts hands the tooltip a loosely typed bundle; this digs out the data
// point under the cursor, or undefined when the mouse isn't over the chart.
function hoveredPoint(props: unknown): HistoryPoint | undefined {
  const { active, payload } = props as { active?: boolean; payload?: ReadonlyArray<{ payload?: HistoryPoint }> }
  return active ? payload?.[0]?.payload : undefined
}

interface TooltipProps {
  point: HistoryPoint | undefined
  series: Series[]
  renderValue: (value: number) => ReactNode
}

function ChartTooltip({ point, series, renderValue }: TooltipProps) {
  if (!point) return null
  return (
    <div className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 text-zinc-400">{formatDateTime(point.takenAt)}</div>
      {series.map((s) => (
        <div key={s.key} className="flex items-center justify-between gap-6">
          <span className="inline-flex items-center gap-1.5 text-zinc-400">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
            {s.label}
          </span>
          {/* Values stay in normal text colour; the dot carries the identity. */}
          <span className="tabular text-zinc-100">{renderValue(point[s.key])}</span>
        </div>
      ))}
    </div>
  )
}
