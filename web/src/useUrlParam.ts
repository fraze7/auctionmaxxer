import { useCallback } from 'react'
import { useSearchParams } from 'react-router'

// Like useState, but the value lives in the URL's query string, so filters
// can be bookmarked. An empty value removes the parameter.
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
        // replace: typing shouldn't add a Back-button step per key.
        { replace: true },
      )
    },
    [name, fallback, setParams],
  )

  return [value, setValue]
}

// A whole number >= 0, or undefined.
export function toWholeNumber(text: string): number | undefined {
  if (!/^\d+$/.test(text)) return undefined
  return Number(text)
}

// Changes several URL values in one step. Two separate setters in a row don't
// work: the second starts from the old URL and undoes the first.
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

// Read from the address bar: the router's own copy lags a render behind,
// so quick successive changes would overwrite each other.
function currentParams(): URLSearchParams {
  return new URLSearchParams(window.location.search)
}
