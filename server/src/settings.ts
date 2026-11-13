import { z } from "zod";
import type { Db } from "./db.js";

// Reads the text-valued `settings` table into a typed, range-checked object.
// Missing keys fall back to the defaults here.

const SettingsSchema = z.object({
  ah_cut: z.coerce.number().min(0).max(0.5).default(0.05),
  deal_min_snapshots: z.coerce.number().int().min(1).default(48),
  deal_trend_falling: z.coerce.number().positive().max(1).default(0.85),
  deal_trend_rising: z.coerce.number().min(1).default(1.15),
  deal_max_price_ratio: z.coerce.number().positive().max(1).default(0.8),
  deal_min_profit: z.coerce.number().int().min(0).default(1),
});

export interface Settings {
  ahCut: number; // share of the sale price the AH keeps, e.g. 0.05
  dealMinSnapshots: number;
  dealTrendFalling: number;
  dealTrendRising: number;
  dealMaxPriceRatio: number;
  dealMinProfit: number; // copper per unit
}

export function loadSettings(db: Db): Settings {
  const rows = db.prepare<[], { key: string; value: string }>("SELECT key, value FROM settings").all();
  const raw = Object.fromEntries(rows.map((row) => [row.key, row.value]));

  const parsed = SettingsSchema.safeParse(raw);
  if (!parsed.success) {
    const problem = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Bad value in the settings table - ${problem}`);
  }
  const s = parsed.data;
  return {
    ahCut: s.ah_cut,
    dealMinSnapshots: s.deal_min_snapshots,
    dealTrendFalling: s.deal_trend_falling,
    dealTrendRising: s.deal_trend_rising,
    dealMaxPriceRatio: s.deal_max_price_ratio,
    dealMinProfit: s.deal_min_profit,
  };
}
