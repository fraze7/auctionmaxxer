import { useState } from 'react'
import { Link } from 'react-router'

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
  // In tables the name links to the item's page. On that page itself, pass
  // link={false}: a link to the page you're already on is just noise.
  link?: boolean
}

// An item's name in its quality colour, with a button that copies the name
// so it can be pasted into the in-game auction search.
//
// Items Blizzard has no name for are shown, not hidden: "Unknown item #123",
// with a Wowhead link so you can look up what it is.
export function ItemName({ id, name, quality, link = true }: Props) {
  const [copied, setCopied] = useState(false)

  async function copy(text: string) {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  const label = name ?? `Unknown item #${id}`
  const color = name === null ? 'text-zinc-500 italic' : (QUALITY_COLOR[quality ?? ''] ?? 'text-zinc-100')
  const smallButton =
    'rounded px-1 text-xs text-zinc-500 opacity-0 group-hover:opacity-100 hover:bg-zinc-800 hover:text-zinc-200 focus:opacity-100'

  return (
    <span className="group inline-flex items-center gap-2">
      {link ? (
        <Link to={`/item/${id}`} className={`${color} hover:underline`}>
          {label}
        </Link>
      ) : (
        <span className={color}>{label}</span>
      )}
      {name === null ? (
        <a href={`https://www.wowhead.com/item=${id}`} target="_blank" rel="noreferrer" className={smallButton}>
          wowhead
        </a>
      ) : (
        <button
          type="button"
          onClick={() => copy(name)}
          title="Copy name for the in-game search"
          className={smallButton}
        >
          {copied ? 'copied' : 'copy'}
        </button>
      )}
    </span>
  )
}
