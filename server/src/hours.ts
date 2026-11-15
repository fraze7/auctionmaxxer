import type { Db } from "./db.js";
import { median } from "./deals.js";

// How an item's cheapest price moves through the day. Each snapshot's price is
// compared with the median of the day around it (12 hours either side), so a
// rising or falling week does not drown the daily rhythm. The ratios are then
// grouped by hour of day (UTC) and the median taken.

const HOUR_SECONDS = 60 * 60;
const DAY_SECONDS = 24 * HOUR_SECONDS;
const WINDOW_DAYS = 14;
// A snapshot is only judged if this many others lie within 12 hours of it.
const MIN_AROUND = 12;
// Days an hour must have been seen on before it gets a figure.
const MIN_SAMPLES = 5;

export interface HourOfDay {
  hour: number; // 0-23, UTC
  ratio: number | null; // price / the day's typical price; null = too few samples
  samples: number;
}

export interface HourlyPattern {
  days: number; // span of history used
  ready: boolean; // every hour has a figure
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

  const byHour: number[][] = Array.from({ length: 24 }, () => []);
  for (const point of points) {
    const around = points.filter((other) => Math.abs(other.takenAt - point.takenAt) <= DAY_SECONDS / 2);
    // Without both halves of the day the "typical" price leans one way.
    const before = around.some((other) => other.takenAt <= point.takenAt - 8 * HOUR_SECONDS);
    const after = around.some((other) => other.takenAt >= point.takenAt + 8 * HOUR_SECONDS);
    if (around.length < MIN_AROUND || !before || !after) continue;
    const typical = median(around.map((other) => other.minPrice));
    if (typical > 0) byHour[new Date(point.takenAt * 1000).getUTCHours()]!.push(point.minPrice / typical);
  }

  const hours = byHour.map((ratios, hour): HourOfDay => {
    if (ratios.length < MIN_SAMPLES) return { hour, ratio: null, samples: ratios.length };
    const sorted = [...ratios].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    const ratio = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
    return { hour, ratio, samples: ratios.length };
  });

  const first = points[0];
  const last = points[points.length - 1];
  return {
    days: first && last ? (last.takenAt - first.takenAt) / DAY_SECONDS : 0,
    ready: hours.every((entry) => entry.ratio !== null),
    hours,
  };
}
