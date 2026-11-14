import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { vendorApi, type VendorDeal } from '../api.ts'
import { DataTable, type Column } from '../components/DataTable.tsx'
import { ItemName } from '../components/ItemName.tsx'
import { PriceTag } from '../components/PriceTag.tsx'
import { EmptyState, ErrorState, LoadingState } from '../components/States.tsx'
import { formatNumber } from '../format.ts'

// Items listed for less than a vendor pays. Worked out on the server
// (server/src/vendor.ts).

export function VendorPage() {
  const vendor = useQuery({
    queryKey: ['vendor'],
    queryFn: vendorApi.list,
    placeholderData: keepPreviousData,
    refetchInterval: 5 * 60_000,
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-zinc-100">Vendor</h1>
        <p className="text-sm text-zinc-500">
          Items on the auction house for less than a vendor pays for them: buy, then sell to any vendor.
        </p>
      </div>

      {vendor.isPending ? (
        <LoadingState />
      ) : vendor.isError ? (
        <ErrorState error={vendor.error} />
      ) : (
        <>
          {vendor.data.unpriced > 0 && (
            <div className="rounded-lg border border-amber-800 bg-amber-950/60 px-4 py-3 text-sm text-amber-200">
              Still looking up vendor prices: {formatNumber(vendor.data.unpriced)} of{' '}
              {formatNumber(vendor.data.priced + vendor.data.unpriced)} items to go. The list fills in as they arrive.
            </div>
          )}
          {vendor.data.deals.length === 0 ? (
            <EmptyState title="Nothing below vendor price">
              <p>No item is listed for less than a vendor pays right now.</p>
            </EmptyState>
          ) : (
            <>
              <DataTable
                rows={vendor.data.deals}
                columns={COLUMNS}
                rowKey={(deal) => deal.id}
                initialSort={{ key: 'profit', direction: 'desc' }}
              />
              <p className="text-xs text-zinc-500">
                Profit is for buying every unit listed below the vendor price. There is no auction house cut on a
                vendor sale. Listings this cheap go quickly, so check the price in game before buying.
              </p>
            </>
          )}
        </>
      )}
    </div>
  )
}

const COLUMNS: Column<VendorDeal>[] = [
  {
    key: 'item',
    header: 'Item',
    render: (deal) => <ItemName id={deal.id} name={deal.name} quality={deal.quality} />,
    sortValue: (deal) => deal.name ?? '',
  },
  {
    key: 'minPrice',
    header: 'Cheapest',
    align: 'right',
    render: (deal) => <PriceTag copper={deal.minPrice} />,
    sortValue: (deal) => deal.minPrice,
  },
  {
    key: 'vendorPrice',
    header: 'Vendor pays',
    align: 'right',
    render: (deal) => <PriceTag copper={deal.vendorPrice} />,
    sortValue: (deal) => deal.vendorPrice,
  },
  {
    key: 'quantity',
    header: 'Units below',
    align: 'right',
    render: (deal) => formatNumber(deal.quantity),
    sortValue: (deal) => deal.quantity,
  },
  {
    key: 'cost',
    header: 'Cost',
    align: 'right',
    render: (deal) => <PriceTag copper={deal.cost} />,
    sortValue: (deal) => deal.cost,
  },
  {
    key: 'profit',
    header: 'Profit',
    align: 'right',
    render: (deal) => <PriceTag copper={deal.profit} />,
    sortValue: (deal) => deal.profit,
  },
]
