import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api, type ItemSummary } from '../api.ts'
import { DataTable, type Column } from '../components/DataTable.tsx'
import { ItemName } from '../components/ItemName.tsx'
import { PriceTag } from '../components/PriceTag.tsx'
import { EmptyState, ErrorState, LoadingState } from '../components/States.tsx'
import { formatNumber } from '../format.ts'
import { toWholeNumber, useUrlParam } from '../useUrlParam.ts'

// Search every item the collector has seen, with its current price.

const PAGE_SIZE = 50
const dash = <span className="text-zinc-600">-</span>

// Sorting happens on the server (by name) because results are paged: sorting
// only the 50 rows on screen would be misleading. So no sortValue here.
const columns: Column<ItemSummary>[] = [
  { key: 'item', header: 'Item', render: (i) => <ItemName id={i.id} name={i.name} quality={i.quality} /> },
  {
    key: 'min',
    header: 'Min',
    title: 'Cheapest unit price right now',
    align: 'right',
    render: (i) => (i.price ? <PriceTag copper={i.price.minPrice} /> : dash),
  },
  {
    key: 'median',
    header: 'Median',
    title: 'Median unit price across everything listed, weighted by quantity',
    align: 'right',
    render: (i) => (i.price ? <PriceTag copper={i.price.medianPrice} /> : dash),
  },
  {
    key: 'qtyAtMin',
    header: 'Qty at min',
    title: 'Units on sale at the min price',
    align: 'right',
    render: (i) => (i.price ? formatNumber(i.price.qtyAtMin) : dash),
  },
  {
    key: 'quantity',
    header: 'Total listed',
    align: 'right',
    render: (i) => (i.price ? formatNumber(i.price.quantity) : <span className="text-zinc-600">not listed</span>),
  },
  {
    key: 'listings',
    header: 'Listings',
    title: 'Separate auctions - a rough count of sellers',
    align: 'right',
    render: (i) => (i.price ? formatNumber(i.price.listingCount) : dash),
  },
]

export function ItemsPage() {
  const [q, setQ] = useUrlParam('q')
  const [pageText, setPageText] = useUrlParam('page')
  const page = Math.max(1, toWholeNumber(pageText) ?? 1)

  // What's typed in the box updates instantly; the URL (and so the request)
  // follows 300 ms after the last keystroke. Without this "debounce", typing
  // "peacebloom" would fire ten requests.
  const [typed, setTyped] = useState(q)
  useEffect(() => {
    if (typed === q) return
    const timer = setTimeout(() => {
      setQ(typed)
      setPageText('') // a new search starts back on page 1
    }, 300)
    return () => clearTimeout(timer) // typing again cancels the pending update
  }, [typed, q, setQ, setPageText])

  const search = useQuery({
    queryKey: ['items', q, page],
    queryFn: () => api.items({ q, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    placeholderData: keepPreviousData,
  })

  const total = search.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="mr-auto">
          <h1 className="text-lg font-semibold text-zinc-100">Items</h1>
          <p className="text-sm text-zinc-500">Every commodity seen so far, with its current price.</p>
        </div>
        <input
          type="search"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder="Search by name or item ID"
          autoFocus
          className="w-72 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
        />
      </div>

      {search.isPending ? (
        <LoadingState />
      ) : search.isError ? (
        <ErrorState error={search.error} />
      ) : search.data.items.length === 0 ? (
        <EmptyState title={q ? `Nothing matches "${q}"` : 'No items yet'}>
          {q ? <p>Check the spelling, or search by item ID.</p> : <p>Items appear after the first snapshot.</p>}
        </EmptyState>
      ) : (
        <>
          <DataTable rows={search.data.items} columns={columns} rowKey={(i) => i.id} />
          <div className="flex items-center justify-between text-sm text-zinc-500">
            <span>
              {formatNumber(total)} {total === 1 ? 'item' : 'items'}
            </span>
            {pageCount > 1 && (
              <span className="flex items-center gap-3">
                <PageButton disabled={page <= 1} onClick={() => setPageText(page === 2 ? '' : String(page - 1))}>
                  Previous
                </PageButton>
                Page {page} of {pageCount}
                <PageButton disabled={page >= pageCount} onClick={() => setPageText(String(page + 1))}>
                  Next
                </PageButton>
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function PageButton({ disabled, onClick, children }: { disabled: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-md border border-zinc-700 px-3 py-1 text-zinc-300 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  )
}
