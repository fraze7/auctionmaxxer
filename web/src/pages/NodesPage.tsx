import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { nodesApi, type NodeItemStat, type NodeStat } from '../api.ts'
import { DataTable, type Column } from '../components/DataTable.tsx'
import { ItemName } from '../components/ItemName.tsx'
import { PriceTag } from '../components/PriceTag.tsx'
import { EmptyState, ErrorState, LoadingState } from '../components/States.tsx'
import { formatDateTime, formatNumber } from '../format.ts'

// What each node type drops, from visits logged in game by the NodeLog addon
// (addon/NodeLog) and uploaded here. Worked out in server/src/nodes.ts.

const NODES_KEY = ['nodes']

export function NodesPage() {
  const nodes = useQuery({ queryKey: NODES_KEY, queryFn: nodesApi.stats, placeholderData: keepPreviousData })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">Nodes</h1>
          <p className="text-sm text-zinc-500">
            What each node type drops and what a visit is worth at today's prices, from the NodeLog addon.
          </p>
        </div>
        <Upload />
      </div>

      {nodes.isPending ? (
        <LoadingState />
      ) : nodes.isError ? (
        <ErrorState error={nodes.error} />
      ) : nodes.data.nodes.length === 0 ? (
        <EmptyState title="No node visits yet">
          <p>
            Mine with the NodeLog addon enabled, then /reload or log out so WoW saves the log. Upload{' '}
            <code className="text-zinc-300">NodeLog.lua</code> from{' '}
            <code className="text-zinc-300">WTF\Account\&lt;account&gt;\SavedVariables</code> in your WoW folder.
          </p>
        </EmptyState>
      ) : (
        <>
          <p className="text-sm text-zinc-400">
            {formatNumber(nodes.data.visits)} visits logged
            {nodes.data.lastVisitAt !== null && <>, the last on {formatDateTime(nodes.data.lastVisitAt)}</>}.
          </p>
          {nodes.data.nodes.map((node) => (
            <Node key={`${node.kind}:${node.node}`} node={node} />
          ))}
          <p className="text-xs text-zinc-500">
            "Drops in" is the share of visits that gave the item at least once; the range after it is where the true
            rate probably lies (95%) and narrows as you log more visits. Value uses the cheapest listing now, after the{' '}
            {Math.round(nodes.data.ahCut * 100)}% auction house cut. Items not listed right now count as nothing.
          </p>
        </>
      )}
    </div>
  )
}

function Upload() {
  const client = useQueryClient()
  const upload = useMutation({
    mutationFn: async (file: File) => nodesApi.upload(await file.text()),
    onSuccess: () => client.invalidateQueries({ queryKey: NODES_KEY }),
  })

  return (
    <div className="flex max-w-xs flex-col items-end gap-1 text-right text-sm">
      <label
        className={[
          'rounded-md px-4 py-1.5 font-medium',
          upload.isPending
            ? 'cursor-default bg-zinc-800 text-zinc-500'
            : 'cursor-pointer bg-amber-500 text-zinc-950 hover:bg-amber-400',
        ].join(' ')}
      >
        {upload.isPending ? 'Uploading…' : 'Upload NodeLog.lua'}
        <input
          type="file"
          accept=".lua"
          className="hidden"
          disabled={upload.isPending}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) upload.mutate(file)
            event.target.value = '' // so the same file can be picked again
          }}
        />
      </label>
      {upload.isError && <span className="text-red-400">{upload.error.message}</span>}
      {upload.isSuccess && (
        <span className="text-green-400">
          {upload.data.added === 0
            ? `Nothing new: all ${formatNumber(upload.data.visits)} visits were already here.`
            : `Added ${formatNumber(upload.data.added)} new visits.`}
          {upload.data.skipped > 0 && (
            <span className="text-amber-300"> {formatNumber(upload.data.skipped)} could not be read.</span>
          )}
          <span className="block text-xs text-zinc-500">Safe to /nodelog clear in game now.</span>
        </span>
      )}
    </div>
  )
}

function Node({ node }: { node: NodeStat }) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-medium text-zinc-100">
          {node.node}
          <span className="ml-2 font-normal text-zinc-500">
            {formatNumber(node.visits)} {node.visits === 1 ? 'visit' : 'visits'}, {(node.taps / node.visits).toFixed(1)}{' '}
            taps each
          </span>
        </h2>
        <span className="text-sm text-zinc-400">
          Worth <PriceTag copper={node.valuePerVisit} /> a visit
        </span>
      </div>
      <p className="text-xs text-zinc-500">
        {node.zones.map((zone) => `${zone.zone} ${formatNumber(zone.visits)}`).join(' · ')}
      </p>
      <DataTable
        rows={node.items}
        columns={COLUMNS}
        rowKey={(item) => item.itemId}
        initialSort={{ key: 'value', direction: 'desc' }}
      />
    </section>
  )
}

// 0.25 -> "25%", 0.031 -> "3.1%"
function percent(share: number): string {
  const value = share * 100
  return `${value >= 10 || value === 0 ? Math.round(value) : value.toFixed(1)}%`
}

const COLUMNS: Column<NodeItemStat>[] = [
  {
    key: 'item',
    header: 'Item',
    render: (item) => <ItemName id={item.itemId} name={item.name} quality={item.quality} link={item.seen} />,
    sortValue: (item) => item.name,
  },
  {
    key: 'share',
    header: 'Drops in',
    title: 'Share of visits that gave it at least once, with the range the true rate probably lies in',
    align: 'right',
    render: (item) => (
      <span className="tabular whitespace-nowrap">
        {percent(item.share)}
        <span className="block text-xs text-zinc-500 sm:ml-1.5 sm:inline">
          {percent(item.shareLow)}–{percent(item.shareHigh)}
        </span>
      </span>
    ),
    sortValue: (item) => item.share,
  },
  {
    key: 'perVisit',
    header: 'Per visit',
    title: 'Average number per visit',
    align: 'right',
    render: (item) => (
      <span className="tabular">{item.perVisit < 10 ? item.perVisit.toFixed(2) : item.perVisit.toFixed(1)}</span>
    ),
    sortValue: (item) => item.perVisit,
  },
  {
    key: 'price',
    header: 'Cheapest now',
    align: 'right',
    render: (item) =>
      item.unitPrice === null ? (
        <span className="text-zinc-500">not listed</span>
      ) : (
        <PriceTag copper={item.unitPrice} />
      ),
    sortValue: (item) => item.unitPrice,
  },
  {
    key: 'value',
    header: 'Value a visit',
    title: 'Per visit, at the cheapest listing after the auction house cut',
    align: 'right',
    render: (item) =>
      item.valuePerVisit === null ? <span className="text-zinc-500">–</span> : <PriceTag copper={item.valuePerVisit} />,
    sortValue: (item) => item.valuePerVisit,
  },
]
