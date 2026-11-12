import { useState } from 'react'

// The game's colour for each item quality.
const QUALITY_COLOR: Record<string, string> = {
  POOR: 'text-zinc-500',
  COMMON: 'text-zinc-100',
  UNCOMMON: 'text-green-400',
  RARE: 'text-blue-400',
  EPIC: 'text-purple-400',
  LEGENDARY: 'text-orange-400',
}

interface Props {
  id: number
  name: string | null
  quality: string | null
}

// An item's name in its quality colour, with a button that copies the name
// so it can be pasted into the in-game auction search.
//
// Items Blizzard has no name for are shown, not hidden: "Unknown item #123",
// linked to Wowhead so you can look up what it is.
export function ItemName({ id, name, quality }: Props) {
  const [copied, setCopied] = useState(false)

  if (name === null) {
    return (
      <a
        href={`https://www.wowhead.com/item=${id}`}
        target="_blank"
        rel="noreferrer"
        className="text-zinc-500 italic underline decoration-dotted hover:text-zinc-300"
      >
        Unknown item #{id}
      </a>
    )
  }

  async function copy(text: string) {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  return (
    <span className="group inline-flex items-center gap-2">
      <span className={QUALITY_COLOR[quality ?? ''] ?? 'text-zinc-100'}>{name}</span>
      <button
        type="button"
        onClick={() => copy(name)}
        title="Copy name for the in-game search"
        className="rounded px-1 text-xs text-zinc-500 opacity-0 group-hover:opacity-100 hover:bg-zinc-800 hover:text-zinc-200 focus:opacity-100"
      >
        {copied ? 'copied' : 'copy'}
      </button>
    </span>
  )
}
