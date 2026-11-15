import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { profileApi, type ProfileProfession } from '../api.ts'
import { ErrorState, LoadingState } from '../components/States.tsx'
import { PROFILE_KEY, useProfile } from '../profile.ts'

// Your character's professions and skill levels. Saved on the server, so it
// follows you between devices and Crafts alerts can use it.

export function CharacterPage() {
  const profile = useProfile()
  if (profile.isPending) return <LoadingState />
  if (profile.isError) return <ErrorState error={profile.error} />
  return <Form professions={profile.data.professions} />
}

function Form({ professions }: { professions: ProfileProfession[] }) {
  const client = useQueryClient()
  const save = useMutation({
    mutationFn: profileApi.save,
    onSuccess: (data) => client.setQueryData(PROFILE_KEY, data),
  })
  // Skill as typed; an empty string means the character does not have the profession.
  const [skills, setSkills] = useState<Record<string, string>>(() =>
    Object.fromEntries(professions.map((p) => [p.id, p.skill === null ? '' : String(p.skill)])),
  )

  const toSave = Object.fromEntries(
    Object.entries(skills).flatMap(([id, text]) => {
      const skill = Math.min(Math.max(Number(text), 1), 300)
      return text === '' ? [] : [[id, skill] as const]
    }),
  )
  const saved = Object.fromEntries(professions.flatMap((p) => (p.skill === null ? [] : [[p.id, p.skill] as const])))
  const unchanged = JSON.stringify(toSave) === JSON.stringify(saved)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-zinc-100">Character</h1>
        <p className="text-sm text-zinc-500">
          Tick the professions your character has and enter the skill. Levelling then starts from your skill, Crafts
          shows what you can make, and Crafts alerts only fire for recipes you know.
        </p>
      </div>

      <div className="max-w-xl divide-y divide-zinc-800 rounded-lg border border-zinc-800">
        {professions.map((profession) => {
          const text = skills[profession.id] ?? ''
          const has = text !== ''
          return (
            <div key={profession.id} className="flex items-center gap-4 px-4 py-2.5 text-sm">
              <label className="flex flex-1 items-center gap-2 text-zinc-100">
                <input
                  type="checkbox"
                  checked={has}
                  onChange={(event) => setSkills({ ...skills, [profession.id]: event.target.checked ? '1' : '' })}
                  className="accent-amber-500"
                />
                {profession.name}
                {profession.kind === 'gathering' && <span className="text-xs text-zinc-500">gathering</span>}
              </label>
              {has && (
                <label className="flex items-center gap-2 text-xs text-zinc-400">
                  Skill
                  <input
                    type="text"
                    inputMode="numeric"
                    value={text}
                    onChange={(event) =>
                      setSkills({ ...skills, [profession.id]: event.target.value.replace(/\D/g, '').slice(0, 3) || '1' })
                    }
                    className="tabular w-16 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none"
                  />
                </label>
              )}
            </div>
          )
        })}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={unchanged || save.isPending}
          onClick={() => save.mutate(toSave)}
          className="rounded-md bg-amber-500 px-4 py-1.5 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:cursor-default disabled:bg-zinc-800 disabled:text-zinc-500"
        >
          Save
        </button>
        {save.isError && <span className="text-sm text-red-400">{save.error.message}</span>}
        {unchanged && save.isSuccess && <span className="text-sm text-green-400">Saved</span>}
      </div>
    </div>
  )
}
