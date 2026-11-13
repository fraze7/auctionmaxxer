import { useCallback } from 'react'
import { useSearchParams } from 'react-router'

// Like useState, but the value lives in the URL's query string
// (?minProfit=500) instead of in memory. That makes every filter
// bookmarkable: reopen the link and the page looks exactly as you left it.
//
// An empty value removes the parameter, keeping URLs short.
export function useUrlParam(name: string, fallback = ''): [string, (value: string) => void] {
  const [params, setParams] = useSearchParams()
  const value = params.get(name) ?? fallback

  const setValue = useCallback(
    (next: string) => {
      setParams(
        () => {
          const updated = currentParams()
          if (next === '' || next === fallback) updated.delete(name)
          else updated.set(name, next)
          return updated
        },
        // replace: typing in a filter shouldn't add a Back-button step per key.
        { replace: true },
      )
    },
    [name, fallback, setParams],
  )

  return [value, setValue]
}

// Reads a URL value as a whole number >= 0, or undefined if it isn't one.
export function toWholeNumber(text: string): number | undefined {
  if (!/^\d+$/.test(text)) return undefined
  return Number(text)
}

// Changes several URL values in ONE step. An empty value removes that one.
//
// Needed whenever two values change together (a new search also resets the
// page number). Calling two separate setters in a row does NOT work: each
// one starts from the URL as it was before either ran, so the second call
// silently undoes the first.
export function useUpdateUrlParams(): (changes: Record<string, string>) => void {
  const [, setParams] = useSearchParams()
  return useCallback(
    (changes) => {
      setParams(
        () => {
          const updated = currentParams()
          for (const [name, value] of Object.entries(changes)) {
            if (value === '') updated.delete(name)
            else updated.set(name, value)
          }
          return updated
        },
        { replace: true },
      )
    },
    [setParams],
  )
}

// The URL's query values as they are right now, read from the address bar.
//
// The router also offers its own copy, but that one updates a moment later
// (after React re-renders). Two changes in quick succession - type in a
// field, then click a toggle - would both start from the older copy, and the
// second would wipe out the first. The address bar is always up to date.
function currentParams(): URLSearchParams {
  return new URLSearchParams(window.location.search)
}
