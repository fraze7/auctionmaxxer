import type { ReactNode } from 'react'
import { ApiUnreachableError } from '../api.ts'

// What a page shows instead of its table: loading, nothing to show, or an error.

export function LoadingState() {
  return <div className="rounded-lg border border-zinc-800 p-8 text-center text-sm text-zinc-500">Loading…</div>
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-700 p-8 text-center">
      <p className="font-medium text-zinc-200">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-xl text-sm text-zinc-400">{children}</div>}
    </div>
  )
}

export function ErrorState({ error }: { error: unknown }) {
  // The most common cause by far: the SSH tunnel to the server isn't running.
  if (error instanceof ApiUnreachableError) {
    return (
      <div className="rounded-lg border border-red-900 bg-red-950/40 p-6 text-sm">
        <p className="font-medium text-red-200">Can't reach the API</p>
        <p className="mt-2 text-red-200/80">
          The API runs on the server and is reached through an SSH tunnel. Start it in a terminal and leave it
          running:
        </p>
        <pre className="mt-3 overflow-x-auto rounded bg-zinc-950 p-3 text-zinc-200">
          ssh -N -L 3001:127.0.0.1:3001 auctionmaxxer
        </pre>
      </div>
    )
  }
  return (
    <div className="rounded-lg border border-red-900 bg-red-950/40 p-6 text-sm text-red-200">
      <p className="font-medium">Something went wrong</p>
      <p className="mt-1 text-red-200/80">{error instanceof Error ? error.message : String(error)}</p>
    </div>
  )
}
