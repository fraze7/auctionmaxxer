import { useMemo, useState, type ReactNode } from 'react'

// A dense table shared by every page. Columns with a `sortValue` are sortable.
// On a phone each row becomes a card: the first column as its heading, text
// columns on a line each, number columns three to a row.

export interface Column<T> {
  key: string
  header: string
  title?: string // tooltip explaining the column
  align?: 'left' | 'right'
  render: (row: T) => ReactNode
  // Leave out to make the column unsortable.
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

  const sorted = useMemo(() => {
    const column = columns.find((c) => c.key === sort?.key)
    const sortValue = column?.sortValue
    if (!sort || !sortValue) return rows

    const flip = sort.direction === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const x = sortValue(a)
      const y = sortValue(b)
      // Missing values go last in either direction.
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

  const [first, ...rest] = columns
  const sortable = columns.filter((column) => column.sortValue)

  return (
    <>
      <div className="space-y-2 md:hidden">
        {sortable.length > 1 && (
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <label className="flex items-center gap-2">
              Sort by
              <select
                value={sort?.key ?? ''}
                onChange={(event) => {
                  const column = columns.find((c) => c.key === event.target.value)
                  if (column) setSort({ key: column.key, direction: column.align === 'right' ? 'desc' : 'asc' })
                }}
                className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100"
              >
                {!sort && <option value="">–</option>}
                {sortable.map((column) => (
                  <option key={column.key} value={column.key}>
                    {column.header}
                  </option>
                ))}
              </select>
            </label>
            {sort && (
              <button
                type="button"
                aria-label="Reverse the order"
                onClick={() => setSort({ ...sort, direction: sort.direction === 'asc' ? 'desc' : 'asc' })}
                className="rounded-md border border-zinc-700 px-2 py-1 text-sm text-zinc-300"
              >
                {sort.direction === 'asc' ? '▲' : '▼'}
              </button>
            )}
          </div>
        )}
        <ul className="divide-y divide-zinc-800/70 rounded-lg border border-zinc-800">
          {sorted.map((row) => (
            <li key={rowKey(row)} className="space-y-2 px-3 py-2.5 text-sm">
              {first && <div>{first.render(row)}</div>}
              <dl className="grid grid-cols-3 gap-x-3 gap-y-2">
                {rest.map((column) => (
                  <div key={column.key} className={column.align === 'right' ? '' : 'col-span-3'}>
                    {column.header && (
                      <dt className="text-[11px] tracking-wide text-zinc-500 uppercase">{column.header}</dt>
                    )}
                    <dd className={column.align === 'right' ? 'tabular' : ''}>{column.render(row)}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      </div>

      <div className="hidden overflow-x-auto rounded-lg border border-zinc-800 md:block">
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
    </>
  )
}
