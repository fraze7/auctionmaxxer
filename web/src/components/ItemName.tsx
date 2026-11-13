import { useState } from 'react'
import { Link } from 'react-router'

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
  // Pass false on the item's own page.
  link?: boolean
}

// An item's name in its quality colour, with copy and Wowhead buttons.
// Unnamed items show as "Unknown item #123".
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
      {name !== null && (
        <button
          type="button"
          onClick={() => copy(name)}
          title="Copy name for the in-game search"
          className={smallButton}
        >
          {copied ? 'copied' : 'copy'}
        </button>
      )}
      <a
        href={wowheadUrl(id, name)}
        target="_blank"
        rel="noreferrer"
        title="Open this item on Wowhead"
        className={smallButton}
      >
        wowhead
      </a>
    </span>
  )
}

// e.g. https://www.wowhead.com/forever/item=12365/dense-stone
// The slug is optional, so unnamed items leave it off.
export function wowheadUrl(id: number, name: string | null): string {
  const base = `https://www.wowhead.com/forever/item=${id}`
  if (name === null) return base
  const slug = name
    .toLowerCase()
    .replace(/'/g, '') // "Crusader's Helm" -> "crusaders helm"
    .replace(/[^a-z0-9]+/g, '-') // anything else that isn't a letter or digit -> dash
    .replace(/^-+|-+$/g, '') // no dash at either end
  return slug ? `${base}/${slug}` : base
}
