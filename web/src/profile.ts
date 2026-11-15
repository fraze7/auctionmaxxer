import { useQuery } from '@tanstack/react-query'
import { profileApi } from './api.ts'

// The saved character, shared by the pages that adapt to it.

export const PROFILE_KEY = ['profile']

export function useProfile() {
  return useQuery({ queryKey: PROFILE_KEY, queryFn: profileApi.get, staleTime: 5 * 60_000 })
}

// profession id -> skill, for the professions the character has. Empty until loaded.
export function useSkills(): ReadonlyMap<string, number> {
  const professions = useProfile().data?.professions ?? []
  return new Map(professions.flatMap((p) => (p.skill === null ? [] : [[p.id, p.skill] as const])))
}
