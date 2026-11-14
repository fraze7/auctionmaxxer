import type { Recipe } from "../levelling.js";

// r(spell, name, [orange, yellow, grey], [item, quantity], reagents, plan?)
// Wowhead gives orange 0 for a few recipes; their real learn level is unknown,
// so they are treated as learnable from yellow.
export const r = (
  spellId: number,
  name: string,
  [orange, yellow, grey]: [number, number, number],
  [itemId, quantity]: [number, number],
  reagents: Array<[number, number]>,
  plan = false,
): Recipe => ({
  spellId,
  name,
  learn: orange > 0 ? orange : yellow,
  yellow,
  grey,
  makes: { itemId, quantity },
  reagents: reagents.map(([id, qty]) => ({ itemId: id, quantity: qty })),
  ...(plan ? { plan: true } : {}),
});
