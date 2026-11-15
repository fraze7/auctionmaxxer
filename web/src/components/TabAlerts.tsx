import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { tabAlertApi, type TabAlert, type TabKind, type TabRule } from '../api.ts'
import { formatDateTime } from '../format.ts'
import { DataTable, type Column } from './DataTable.tsx'
import { ItemName } from './ItemName.tsx'
import { PriceTag } from './PriceTag.tsx'

// Alerts for whole tabs: one on/off switch and a minimum profit per tab.

const TABS: Array<{ kind: TabKind; name: string; what: string }> = [
  { kind: 'deal', name: 'Deals', what: 'a deal with at least this total profit' },
  { kind: 'reset', name: 'Resets', what: 'a reset with at least this profit that would sell within three days' },
  { kind: 'vendor', name: 'Vendor', what: 'an item below vendor price with at least this profit' },
  { kind: 'craft', name: 'Crafts', what: 'a recipe with at least this total profit' },
]
const TAB_NAME = Object.fromEntries(TABS.map((tab) => [tab.kind, tab.name])) as Record<TabKind, string>

export function TabAlertSettings({ rules }: { rules: TabRule[] }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-zinc-100">Tab alerts</h2>
      <p className="text-sm text-zinc-500">
        A Discord message when a tab lists something worth your while. Each item alerts once a day per tab, with at
        most five alerts per tab per snapshot.
      </p>
      <div className="divide-y divide-zinc-800 rounded-lg border border-zinc-800">
        {TABS.map((tab) => (
          <Row key={tab.kind} {...tab} rule={rules.find((rule) => rule.kind === tab.kind)} />
        ))}
      </div>
    </section>
  )
}

function Row({ kind, name, what, rule }: { kind: TabKind; name: string; what: string; rule: TabRule | undefined }) {
  const client = useQueryClient()
  const refresh = () => client.invalidateQueries({ queryKey: ['watchlist'] })
  const save = useMutation({ mutationFn: tabAlertApi.save, onSuccess: refresh })
  const remove = useMutation({ mutationFn: tabAlertApi.remove, onSuccess: refresh })

  // Whole gold; the server stores copper.
  const [goldText, setGoldText] = useState(rule ? String(Math.round(rule.minProfit / 10_000)) : '5')
  const gold = Number(goldText || '0')
  const unchanged = rule !== undefined && rule.minProfit === gold * 10_000
  const error = save.error ?? remove.error

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
      <div className="min-w-48 flex-1">
        <span className="font-medium text-zinc-100">{name}</span>
        {rule ? (
          <span className="ml-2 text-xs text-green-400">on</span>
        ) : (
          <span className="ml-2 text-xs text-zinc-500">off</span>
        )}
        <div className="text-xs text-zinc-500">Alert on {what}.</div>
        {error && <div className="text-xs text-red-400">{error.message}</div>}
      </div>
      <label className="flex items-center gap-2 text-xs text-zinc-400">
        At least
        <input
          type="text"
          inputMode="numeric"
          value={goldText}
          onChange={(event) => setGoldText(event.target.value.replace(/\D/g, '').slice(0, 5))}
          className="tabular w-20 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none"
        />
        gold
      </label>
      <button
        type="button"
        disabled={unchanged || save.isPending}
        onClick={() => save.mutate({ kind, minProfit: gold * 10_000 })}
        className="rounded-md bg-amber-500 px-3 py-1 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:cursor-default disabled:bg-zinc-800 disabled:text-zinc-500"
      >
        {rule ? 'Update' : 'Turn on'}
      </button>
      {rule && (
        <button
          type="button"
          disabled={remove.isPending}
          onClick={() => remove.mutate(kind)}
          className="text-xs text-zinc-500 hover:text-red-400"
        >
          Turn off
        </button>
      )}
    </div>
  )
}

const COLUMNS: Column<TabAlert>[] = [
  {
    key: 'when',
    header: 'Snapshot',
    render: (alert) => <span className="text-zinc-400">{formatDateTime(alert.takenAt)}</span>,
  },
  { key: 'tab', header: 'Tab', render: (alert) => <span className="text-zinc-400">{TAB_NAME[alert.kind]}</span> },
  {
    key: 'item',
    header: 'Item',
    render: (alert) => <ItemName id={alert.itemId} name={alert.name} quality={alert.quality} />,
  },
  { key: 'profit', header: 'Profit', align: 'right', render: (alert) => <PriceTag copper={alert.profit} /> },
  {
    key: 'discord',
    header: 'Discord',
    render: (alert) =>
      alert.notifiedAt ? (
        <span className="text-xs text-green-400">Sent</span>
      ) : (
        <span className="text-xs text-zinc-500">Not sent</span>
      ),
  },
]

export function RecentTabAlerts({ alerts }: { alerts: TabAlert[] }) {
  if (alerts.length === 0) return null
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-zinc-100">Recent tab alerts</h2>
      <DataTable rows={alerts} columns={COLUMNS} rowKey={(alert) => alert.id} />
    </section>
  )
}
