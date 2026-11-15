import { NavLink, Navigate, Route, Routes } from 'react-router'
import { LastUpdated, RefreshOnNewSnapshot, StaleBanner } from './components/StatusBar.tsx'
import { DealsPage } from './pages/DealsPage.tsx'
import { CraftsPage } from './pages/CraftsPage.tsx'
import { FavorPage } from './pages/FavorPage.tsx'
import { ItemPage } from './pages/ItemPage.tsx'
import { ItemsPage } from './pages/ItemsPage.tsx'
import { LevellingPage } from './pages/LevellingPage.tsx'
import { MoversPage } from './pages/MoversPage.tsx'
import { RecordPage } from './pages/RecordPage.tsx'
import { ResetsPage } from './pages/ResetsPage.tsx'
import { VendorPage } from './pages/VendorPage.tsx'
import { WatchlistPage } from './pages/WatchlistPage.tsx'
import { useWatchlist } from './watchlist.tsx'

export default function App() {
  // Shown as a count on the Watchlist tab.
  const triggered = useWatchlist().data?.watches.filter((w) => w.triggeredAt !== null).length ?? 0

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-zinc-800 bg-zinc-900/60">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <span className="font-semibold tracking-tight text-amber-400">auctionmaxxer</span>
          <nav className="flex gap-1 text-sm">
            <Tab to="/">Deals</Tab>
            <Tab to="/items">Items</Tab>
            <Tab to="/movers">Movers</Tab>
            <Tab to="/resets">Resets</Tab>
            <Tab to="/vendor">Vendor</Tab>
            <Tab to="/favor">Favor</Tab>
            <Tab to="/crafts">Crafts</Tab>
            <Tab to="/levelling">Levelling</Tab>
            <Tab to="/record">Record</Tab>
            <Tab to="/watchlist" badge={triggered}>
              Watchlist
            </Tab>
          </nav>
          <span className="ml-auto">
            <LastUpdated />
          </span>
        </div>
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
          <Route path="/resets" element={<ResetsPage />} />
          <Route path="/vendor" element={<VendorPage />} />
          <Route path="/crafts" element={<CraftsPage />} />
          <Route path="/levelling" element={<LevellingPage />} />
          <Route path="/record" element={<RecordPage />} />
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

function Tab({ to, badge = 0, children }: { to: string; badge?: number; children: string }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        [
          'rounded px-3 py-1.5',
          isActive ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-100',
        ].join(' ')
      }
    >
      {children}
      {badge > 0 && (
        <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-zinc-950">{badge}</span>
      )}
    </NavLink>
  )
}
