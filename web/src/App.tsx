import { NavLink, Navigate, Route, Routes } from 'react-router'
import { LastUpdated, StaleBanner } from './components/StatusBar.tsx'
import { DealsPage } from './pages/DealsPage.tsx'
import { ItemPage } from './pages/ItemPage.tsx'
import { ItemsPage } from './pages/ItemsPage.tsx'

// The frame around every page: header with navigation, the stale-data
// warning, the current page, and the footer.
export default function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-zinc-800 bg-zinc-900/60">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <span className="font-semibold tracking-tight text-amber-400">auctionmaxxer</span>
          <nav className="flex gap-1 text-sm">
            <Tab to="/">Deals</Tab>
            <Tab to="/items">Items</Tab>
          </nav>
          <span className="ml-auto">
            <LastUpdated />
          </span>
        </div>
      </header>
      <StaleBanner />

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        <Routes>
          <Route path="/" element={<DealsPage />} />
          <Route path="/items" element={<ItemsPage />} />
          <Route path="/item/:id" element={<ItemPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <footer className="border-t border-zinc-800 px-4 py-3 text-center text-xs text-zinc-600">
        Auction data from Blizzard's Battle.net API. Not affiliated with or endorsed by Blizzard Entertainment.
      </footer>
    </div>
  )
}

// A navigation link that highlights itself when its page is open.
function Tab({ to, children }: { to: string; children: string }) {
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
    </NavLink>
  )
}
