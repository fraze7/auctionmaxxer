import type { Db } from "./db.js";
import { median } from "./deals.js";

// How an item's cheapest price moves through the day. Each snapshot's price is
// compared with the median of the day around it (12 hours either side), so a
// rising or falling week does not drown the daily rhythm. The ratios are then
// grouped by hour of day (UTC) and the median taken. Odd and even days are
// then compared, since a real daily rhythm shows up in both.

const HOUR_SECONDS = 60 * 60;
const DAY_SECONDS = 24 * HOUR_SECONDS;
const WINDOW_DAYS = 14;
// A snapshot is only judged if this many others lie within 12 hours of it.
const MIN_AROUND = 12;
// Days an hour must have been seen on before it gets a figure.
const MIN_SAMPLES = 5;
// Correlation needed between the odd-day and even-day shapes. On live data
// (18 Nov 2026) 29 of 464 busy items passed, against about 6 by chance.
const MIN_AGREEMENT = 0.6;
const MIN_SHARED_HOURS = 20;

export interface HourOfDay {
  hour: number; // 0-23, UTC
  ratio: number | null; // price / the day's typical price; null = too few samples
  samples: number;
}

export interface HourlyPattern {
  days: number; // span of history used
  ready: boolean; // every hour has a figure
  repeats: boolean; // the cheap and dear hours are the same on odd and even days
  hours: HourOfDay[];
}

export function hourlyPattern(db: Db, houseId: number, itemId: number): HourlyPattern {
  const latest = db
    .prepare<[number], { takenAt: number }>(
      `
      SELECT taken_at AS takenAt FROM snapshots
      WHERE house_id = ? AND kind = 'commodities' AND status = 'ok'
      ORDER BY taken_at DESC LIMIT 1
    `,
    )
    .get(houseId);
  const points = latest
    ? db
        .prepare<{ itemId: number; houseId: number; since: number }, { takenAt: number; minPrice: number }>(
          `
          SELECT s.taken_at AS takenAt, p.min_price AS minPrice
          FROM commodity_prices p
          JOIN snapshots s ON s.id = p.snapshot_id
          WHERE p.item_id = @itemId AND s.house_id = @houseId AND s.kind = 'commodities' AND s.status = 'ok'
            AND s.taken_at > @since
          ORDER BY s.taken_at
        `,
        )
        .all({ itemId, houseId, since: latest.takenAt - WINDOW_DAYS * DAY_SECONDS })
    : [];

  const emptyHours = (): number[][] => Array.from({ length: 24 }, () => []);
  const byHour = emptyHours();
  const halves = [emptyHours(), emptyHours()];
  for (const point of points) {
    const around = points.filter((other) => Math.abs(other.takenAt - point.takenAt) <= DAY_SECONDS / 2);
    // Without both halves of the day the "typical" price leans one way.
    const before = around.some((other) => other.takenAt <= point.takenAt - 8 * HOUR_SECONDS);
    const after = around.some((other) => other.takenAt >= point.takenAt + 8 * HOUR_SECONDS);
    if (around.length < MIN_AROUND || !before || !after) continue;
    const typical = median(around.map((other) => other.minPrice));
    if (typical <= 0) continue;
    const hour = new Date(point.takenAt * 1000).getUTCHours();
    const ratio = point.minPrice / typical;
    byHour[hour]!.push(ratio);
    halves[Math.floor(point.takenAt / DAY_SECONDS) % 2]![hour]!.push(ratio);
  }

  const hours = byHour.map((ratios, hour): HourOfDay => {
    if (ratios.length < MIN_SAMPLES) return { hour, ratio: null, samples: ratios.length };
    return { hour, ratio: middle(ratios), samples: ratios.length };
  });
  const ready = hours.every((entry) => entry.ratio !== null);

  const first = points[0];
  const last = points[points.length - 1];
  return {
    days: first && last ? (last.takenAt - first.takenAt) / DAY_SECONDS : 0,
    ready,
    repeats: ready && agreement(halves[0]!, halves[1]!) >= MIN_AGREEMENT,
    hours,
  };
}

// Unlike deals.ts's median, this keeps the fraction: these are ratios, not copper.
function middle(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

// Pearson correlation of two by-hour shapes; 0 when there is too little to compare.
function agreement(a: number[][], b: number[][]): number {
  const pairs = a.flatMap((ratios, hour) =>
    ratios.length > 0 && b[hour]!.length > 0 ? [[middle(ratios), middle(b[hour]!)] as const] : [],
  );
  if (pairs.length < MIN_SHARED_HOURS) return 0;
  const meanX = pairs.reduce((sum, [x]) => sum + x, 0) / pairs.length;
  const meanY = pairs.reduce((sum, [, y]) => sum + y, 0) / pairs.length;
  let together = 0;
  let spreadX = 0;
  let spreadY = 0;
  for (const [x, y] of pairs) {
    together += (x - meanX) * (y - meanY);
    spreadX += (x - meanX) ** 2;
    spreadY += (y - meanY) ** 2;
  }
  return spreadX > 0 && spreadY > 0 ? together / Math.sqrt(spreadX * spreadY) : 0;
}
