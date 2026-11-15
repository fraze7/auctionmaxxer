import { useUrlParam } from '../useUrlParam.ts'

// The two lists on the Deals tab, kept in the URL as ?show=.

const VIEWS = [
  { value: 'deals', label: 'Deals' },
  { value: 'resets', label: 'Resets' },
] as const

export type View = (typeof VIEWS)[number]['value']

export function useView(): View {
  const [show] = useUrlParam('show', 'deals')
  return VIEWS.find((view) => view.value === show)?.value ?? 'deals'
}

export function ShowToggle() {
  const [, setShow] = useUrlParam('show', 'deals')
  const current = useView()
  return (
    <div className="flex rounded-md border border-zinc-700 text-sm">
      {VIEWS.map((view) => (
        <button
          key={view.value}
          type="button"
          aria-pressed={current === view.value}
          onClick={() => setShow(view.value)}
          className={[
            'px-3 py-1.5 first:rounded-l-md last:rounded-r-md',
            current === view.value ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-100',
          ].join(' ')}
        >
          {view.label}
        </button>
      ))}
    </div>
  )
}
