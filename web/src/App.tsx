import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router'
import { LastUpdated, RefreshOnNewSnapshot, StaleBanner } from './components/StatusBar.tsx'
import { DealsPage } from './pages/DealsPage.tsx'
import { CharacterPage } from './pages/CharacterPage.tsx'
import { CraftsPage } from './pages/CraftsPage.tsx'
import { FavorPage } from './pages/FavorPage.tsx'
import { ItemPage } from './pages/ItemPage.tsx'
import { ItemsPage } from './pages/ItemsPage.tsx'
import { LevellingPage } from './pages/LevellingPage.tsx'
import { MoversPage } from './pages/MoversPage.tsx'
import { RecordPage } from './pages/RecordPage.tsx'
import { VendorPage } from './pages/VendorPage.tsx'
import { WatchlistPage } from './pages/WatchlistPage.tsx'
import { useWatchlist } from './watchlist.tsx'

// The header shows the groups; the row under it shows the open group's tabs.
const GROUPS = [
  {
    name: 'Buy now',
    tabs: [
      { to: '/', name: 'Deals' },
      { to: '/vendor', name: 'Vendor' },
      { to: '/record', name: 'Record' },
    ],
  },
  {
    name: 'Professions',
    tabs: [
      { to: '/crafts', name: 'Crafts' },
      { to: '/levelling', name: 'Levelling' },
      { to: '/favor', name: 'Favor' },
    ],
  },
  {
    name: 'Market',
    tabs: [
      { to: '/items', name: 'Items' },
      { to: '/movers', name: 'Movers' },
    ],
  },
  // One tab each, so these two are plain links with no row under them.
  { name: 'Watchlist', tabs: [{ to: '/watchlist', name: 'Watchlist' }] },
  { name: 'Character', tabs: [{ to: '/character', name: 'Character' }] },
]

export default function App() {
  // Shown as a count on the Watchlist tab.
  const triggered = useWatchlist().data?.watches.filter((w) => w.triggeredAt !== null).length ?? 0

  // The item page belongs with Items.
  const { pathname } = useLocation()
  const path = pathname.startsWith('/item/') ? '/items' : pathname
  const group = GROUPS.find((candidate) => candidate.tabs.some((tab) => tab.to === path)) ?? GROUPS[0]!

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-zinc-800 bg-zinc-900/60">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <span className="font-semibold tracking-tight text-amber-400">auctionmaxxer</span>
          <nav className="flex gap-1 text-sm">
            {GROUPS.map((candidate) => (
              <Link
                key={candidate.name}
                to={candidate.tabs[0]!.to}
                aria-current={candidate === group ? 'true' : undefined}
                className={[
                  'rounded px-3 py-1.5',
                  candidate === group ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-100',
                ].join(' ')}
              >
                {candidate.name}
                {candidate.name === 'Watchlist' && <Badge count={triggered} />}
              </Link>
            ))}
          </nav>
          <span className="ml-auto">
            <LastUpdated />
          </span>
        </div>
        {group.tabs.length > 1 && (
          <nav className="mx-auto flex max-w-7xl gap-1 px-4 pb-2 text-sm">
            {group.tabs.map((tab) => (
              <Tab key={tab.to} to={tab.to}>
                {tab.name}
              </Tab>
            ))}
          </nav>
        )}
      </header>
      <StaleBanner />
      <RefreshOnNewSnapshot />

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        <Routes>
          <Route path="/" element={<DealsPage />} />
          <Route path="/items" element={<ItemsPage />} />
          <Route path="/item/:id" element={<ItemPage />} />
          <Route path="/favor" element={<FavorPage />} />
          <Route path="/movers" element={<MoversPage />} />
          <Route path="/resets" element={<Navigate to="/?show=resets" replace />} />
          <Route path="/vendor" element={<VendorPage />} />
          <Route path="/crafts" element={<CraftsPage />} />
          <Route path="/levelling" element={<LevellingPage />} />
          <Route path="/record" element={<RecordPage />} />
          <Route path="/character" element={<CharacterPage />} />
          <Route path="/watchlist" element={<WatchlistPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <footer className="border-t border-zinc-800 px-4 py-3 text-center text-xs text-zinc-600">
        Auction data from Blizzard's Battle.net API. Not affiliated with or endorsed by Blizzard Entertainment.
      </footer>
    </div>
  )
}

function Tab({ to, children }: { to: string; children: string }) {
  const { pathname } = useLocation()
  // The item page keeps Items lit.
  const onItem = to === '/items' && pathname.startsWith('/item/')
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        ['rounded px-3 py-1', isActive || onItem ? 'text-amber-400' : 'text-zinc-400 hover:text-zinc-100'].join(' ')
      }
    >
      {children}
    </NavLink>
  )
}

function Badge({ count }: { count: number }) {
  if (count <= 0) return null
  return <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-zinc-950">{count}</span>
}
