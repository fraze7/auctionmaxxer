import { useMemo, useState, type ReactNode } from 'react'

// A dense table that every page reuses. Each page describes its columns;
// the table handles layout and, for columns that give a `sortValue`,
// click-to-sort headers.
//
// <T> is the row type: DataTable<Deal> knows each row is a Deal, so a
// column's render function gets a properly typed row.

export interface Column<T> {
  key: string
  header: string
  title?: string // tooltip explaining the column
  align?: 'left' | 'right'
  render: (row: T) => ReactNode
  // What to sort by. Leave it out to make the column unsortable.
  sortValue?: (row: T) => number | string | null
}

export interface Sort {
  key: string
  direction: 'asc' | 'desc'
}

interface Props<T> {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string | number
  initialSort?: Sort
}

export function DataTable<T>({ rows, columns, rowKey, initialSort }: Props<T>) {
  const [sort, setSort] = useState<Sort | undefined>(initialSort)

  // useMemo: only re-sort when the rows or the sort actually change, not on
  // every re-render.
  const sorted = useMemo(() => {
    const column = columns.find((c) => c.key === sort?.key)
    const sortValue = column?.sortValue
    if (!sort || !sortValue) return rows

    const flip = sort.direction === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const x = sortValue(a)
      const y = sortValue(b)
      // Missing values go last whichever way we sort.
      if (x === null && y === null) return 0
      if (x === null) return 1
      if (y === null) return -1
      if (typeof x === 'string' || typeof y === 'string') return String(x).localeCompare(String(y)) * flip
      return (x - y) * flip
    })
  }, [rows, columns, sort])

  function toggle(column: Column<T>) {
    if (!column.sortValue) return
    setSort((current) =>
      current?.key === column.key
        ? { key: column.key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : // First click: numbers start biggest-first, text starts A-Z.
          { key: column.key, direction: column.align === 'right' ? 'desc' : 'asc' },
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-800">
      <table className="w-full text-sm">
        <thead className="bg-zinc-900 text-xs tracking-wide text-zinc-400 uppercase">
          <tr>
            {columns.map((column) => {
              const active = sort?.key === column.key
              return (
                <th
                  key={column.key}
                  title={column.title}
                  onClick={() => toggle(column)}
                  aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}
                  className={[
                    'px-3 py-2 font-medium whitespace-nowrap select-none',
                    column.align === 'right' ? 'text-right' : 'text-left',
                    column.sortValue ? 'cursor-pointer hover:text-zinc-100' : '',
                    active ? 'text-zinc-100' : '',
                  ].join(' ')}
                >
                  {column.header}
                  {active && <span className="ml-1">{sort.direction === 'asc' ? '▲' : '▼'}</span>}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/70">
          {sorted.map((row) => (
            <tr key={rowKey(row)} className="hover:bg-zinc-900/60">
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={['px-3 py-1.5', column.align === 'right' ? 'tabular text-right' : ''].join(' ')}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
