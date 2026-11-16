import type { Db } from "./db.js";
import { ALL_PROFESSIONS } from "./professions/index.js";

// The owner's character: professions and skill levels. Levelling starts from
// these, Crafts hides what the character cannot make, and Crafts alerts only
// fire for recipes it knows.

export interface ProfileProfession {
  id: string;
  name: string;
  kind: "crafting" | "gathering";
  skill: number | null; // null = the character does not have it
}

// Everything a character can be given on the site.
const KNOWN: Array<Omit<ProfileProfession, "skill">> = ALL_PROFESSIONS.map((p) => ({
  id: p.id,
  name: p.name,
  kind: p.id === "mining" ? "gathering" : "crafting",
}));
export const PROFILE_IDS = KNOWN.map((p) => p.id);

// profession id -> skill, for the professions the character has.
export type Skills = ReadonlyMap<string, number>;

export function loadSkills(db: Db): Skills {
  const rows = db.prepare<[], { profession: string; skill: number }>("SELECT profession, skill FROM character_skills").all();
  return new Map(rows.filter((row) => PROFILE_IDS.includes(row.profession)).map((row) => [row.profession, row.skill]));
}

export function loadProfile(db: Db): ProfileProfession[] {
  const skills = loadSkills(db);
  return KNOWN.map((p) => ({ ...p, skill: skills.get(p.id) ?? null }));
}

// Replaces the whole profile. Unknown professions are ignored.
export function saveProfile(db: Db, skills: Record<string, number>): void {
  const insert = db.prepare("INSERT INTO character_skills (profession, skill) VALUES (?, ?)");
  db.transaction(() => {
    db.prepare("DELETE FROM character_skills").run();
    for (const [profession, skill] of Object.entries(skills)) {
      if (PROFILE_IDS.includes(profession)) insert.run(profession, skill);
    }
  })();
}

// Whether the character can make a recipe. With no profession saved there is
// no profile to go by, so everything counts. Mining counts, for its smelting.
export function canMake(skills: Skills, professionId: string, learn: number): boolean {
  const hasCrafting = ALL_PROFESSIONS.some((p) => skills.has(p.id));
  if (!hasCrafting) return true;
  return (skills.get(professionId) ?? 0) >= learn;
}
