// A row of mutually exclusive buttons. Joined into one bar on wider screens;
// on a phone they wrap as separate buttons, so a long list stays on screen.

export function Picker({
  options,
  value,
  onChange,
}: {
  options: Array<{ id: string; name: string }>
  value: string
  onChange: (id: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1 text-sm sm:flex-nowrap sm:gap-0 sm:rounded-md sm:border sm:border-zinc-700">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={[
            'rounded-md border border-zinc-700 px-3 py-1.5 sm:rounded-none sm:border-0 sm:first:rounded-l-md sm:last:rounded-r-md',
            value === option.id ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-100',
          ].join(' ')}
        >
          {option.name}
        </button>
      ))}
    </div>
  )
}
