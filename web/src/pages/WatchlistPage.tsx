import { Link } from 'react-router'
import type { Watch, WatchAlert } from '../api.ts'
import { DataTable, type Column } from '../components/DataTable.tsx'
import { ItemName } from '../components/ItemName.tsx'
import { PriceTag } from '../components/PriceTag.tsx'
import { RecentTabAlerts, TabAlertSettings } from '../components/TabAlerts.tsx'
import { EmptyState, ErrorState, LoadingState } from '../components/States.tsx'
import { formatDateTime } from '../format.ts'
import { RemoveButton, RuleText, useWatchlist, WatchStatus } from '../watchlist.tsx'

const WATCH_COLUMNS: Column<Watch>[] = [
  {
    key: 'item',
    header: 'Item',
    render: (w) => <ItemName id={w.itemId} name={w.name} quality={w.quality} />,
    sortValue: (w) => w.name,
  },
  {
    key: 'rule',
    header: 'Alert when cheapest is',
    align: 'right',
    render: (w) => <RuleText direction={w.direction} threshold={w.threshold} />,
    sortValue: (w) => w.threshold,
  },
  {
    key: 'current',
    header: 'Current min',
    align: 'right',
    render: (w) => (w.currentMin === null ? <span className="text-zinc-600">-</span> : <PriceTag copper={w.currentMin} />),
    sortValue: (w) => w.currentMin,
  },
  {
    key: 'gap',
    header: 'Distance',
    title: 'How far the current price is from the alert price',
    align: 'right',
    render: (w) => <Gap watch={w} />,
    sortValue: (w) => (w.currentMin === null ? null : Math.abs(w.currentMin - w.threshold) / w.threshold),
  },
  {
    key: 'status',
    header: 'Status',
    render: (w) => (
      <span title={w.triggeredAt ? `Since ${formatDateTime(w.triggeredAt)}` : undefined}>
        <WatchStatus watch={w} />
        {w.triggeredAt && <span className="ml-2 text-xs text-zinc-500">since {formatDateTime(w.triggeredAt)}</span>}
      </span>
    ),
    // Triggered rules first.
    sortValue: (w) => (w.triggeredAt !== null ? 0 : 1),
  },
  { key: 'remove', header: '', align: 'right', render: (w) => <RemoveButton id={w.id} /> },
]

const ALERT_COLUMNS: Column<WatchAlert>[] = [
  { key: 'when', header: 'Snapshot', render: (a) => <span className="text-zinc-400">{formatDateTime(a.takenAt)}</span> },
  { key: 'item', header: 'Item', render: (a) => <ItemName id={a.itemId} name={a.name} quality={a.quality} /> },
  {
    key: 'what',
    header: 'What happened',
    render: (a) => (
      <span>
        {a.direction === 'below' ? 'Dropped to ' : 'Rose to '}
        <PriceTag copper={a.price} />
        <span className="text-zinc-500">
          {' '}
          (alert: <RuleText direction={a.direction} threshold={a.threshold} />)
        </span>
      </span>
    ),
  },
  {
    key: 'discord',
    header: 'Discord',
    render: (a) =>
      a.notifiedAt ? (
        <span className="text-xs text-green-400">Sent</span>
      ) : (
        <span className="text-xs text-zinc-500">Not sent</span>
      ),
  },
]

export function WatchlistPage() {
  const watchlist = useWatchlist()

  if (watchlist.isPending) return <LoadingState />
  if (watchlist.isError) return <ErrorState error={watchlist.error} />
  const { watches, alerts, discordConfigured, tabRules, tabAlerts } = watchlist.data

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Watchlist</h1>
        <p className="text-sm text-zinc-400">
          Price alerts, checked against every new snapshot. An alert fires once when the price crosses your number, and
          again only after it has gone back and crossed a second time.
        </p>
      </div>

      {!discordConfigured && (
        <div className="rounded-lg border border-zinc-700 bg-zinc-900/60 px-4 py-3 text-sm text-zinc-300">
          Discord isn't connected, so alerts only show on this page. To get them as messages, run{' '}
          <code className="rounded bg-zinc-950 px-1.5 py-0.5 text-zinc-100">
            ssh -t auctionmaxxer auctionmaxxer-set-webhook
          </code>{' '}
          and paste a webhook address from your Discord channel.
        </div>
      )}

      {watches.length === 0 ? (
        <EmptyState title="No alerts yet">
          <p>
            Open any item from the <Link to="/items" className="text-amber-400 hover:underline">Items</Link> page and
            use the "Price alert" box to choose a price.
          </p>
        </EmptyState>
      ) : (
        <DataTable
          rows={watches}
          columns={WATCH_COLUMNS}
          rowKey={(w) => w.id}
          initialSort={{ key: 'status', direction: 'asc' }}
        />
      )}

      <TabAlertSettings rules={tabRules} />

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-zinc-100">Recent alerts</h2>
        {alerts.length === 0 ? (
          <p className="text-sm text-zinc-500">Nothing has fired yet.</p>
        ) : (
          <DataTable rows={alerts} columns={ALERT_COLUMNS} rowKey={(a) => a.id} />
        )}
      </section>

      <RecentTabAlerts alerts={tabAlerts} />
    </div>
  )
}

// How far the current price is from the alert price.
function Gap({ watch }: { watch: Watch }) {
  if (watch.currentMin === null) return <span className="text-zinc-600">-</span>
  const percent = Math.round(((watch.currentMin - watch.threshold) / watch.threshold) * 100)
  if (percent === 0) return <span className="text-zinc-300">at the price</span>
  return (
    <span className={watch.triggeredAt !== null ? 'text-amber-300' : 'text-zinc-400'}>
      {Math.abs(percent)}% {percent > 0 ? 'above' : 'below'}
    </span>
  )
}
