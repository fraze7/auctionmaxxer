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
        (current) => {
          const updated = new URLSearchParams(current)
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
