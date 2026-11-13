import type { Db } from "./db.js";

// Sends new watchlist alerts to a Discord channel through a webhook.
//
// A webhook is a secret web address Discord gives you for one channel:
// anything POSTed to it appears there as a message. No bot, no login - which
// also means anyone who learns the address can post to the channel. So it is
// treated like a password: it lives only in server/.env, and this file never
// prints it, not even in an error message.
//
// Sending is kept apart from deciding (watchlist.ts). Alerts are rows in the
// database first; this picks up the ones with no `notified_at` and stamps
// them once Discord has accepted them. If Discord is down, the rows simply
// wait and the next run (ten minutes later) tries again.

// Only ever send to Discord itself. A typo'd or tampered setting can't make
// the server post your alerts somewhere else.
export const WEBHOOK_PATTERN = /^https:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[\w-]+$/;

// An alert that has waited this long is old news: "dropped below 40s" from
// yesterday would only mislead. It stays in the site's history, unsent.
const MAX_AGE_SECONDS = 6 * 60 * 60;
// Discord rejects messages over 2000 characters, so long batches are split.
const MAX_MESSAGE_LENGTH = 1900;

export interface NotifyOptions {
  db: Db;
  webhookUrl: string;
  // The site's address, e.g. https://example.sslip.io - makes item names links.
  siteUrl?: string | undefined;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}

export interface NotifyResult {
  sent: number;
  error?: string;
}

interface PendingAlert {
  id: number;
  itemId: number;
  name: string | null;
  direction: "below" | "above";
  threshold: number;
  price: number;
}

// 123456 -> "12g 34s 56c". Zero parts are left out: 4000 -> "40s".
export function formatCopper(copper: number): string {
  const gold = Math.floor(copper / 10_000);
  const silver = Math.floor((copper % 10_000) / 100);
  const rest = copper % 100;
  const parts = [gold > 0 ? `${gold}g` : "", silver > 0 ? `${silver}s` : "", rest > 0 ? `${rest}c` : ""];
  return parts.filter(Boolean).join(" ") || "0c";
}

// One line of the Discord message for one alert.
export function alertLine(alert: PendingAlert, siteUrl?: string): string {
  const label = alert.name ?? `Item #${alert.itemId}`;
  // [text](address) is Discord's link syntax; <...> stops it adding a preview box.
  const item = siteUrl ? `[**${label}**](<${siteUrl}/item/${alert.itemId}>)` : `**${label}**`;
  return alert.direction === "below"
    ? `📉 ${item} is down to **${formatCopper(alert.price)}** (alert: ${formatCopper(alert.threshold)} or less)`
    : `📈 ${item} is up to **${formatCopper(alert.price)}** (alert: ${formatCopper(alert.threshold)} or more)`;
}

// Groups lines into as few messages as fit Discord's length limit.
function intoMessages(alerts: PendingAlert[], siteUrl?: string): Array<{ content: string; ids: number[] }> {
  const messages: Array<{ content: string; ids: number[] }> = [];
  for (const alert of alerts) {
    const line = alertLine(alert, siteUrl);
    const last = messages.at(-1);
    if (last && last.content.length + 1 + line.length <= MAX_MESSAGE_LENGTH) {
      last.content += `\n${line}`;
      last.ids.push(alert.id);
    } else {
      messages.push({ content: line, ids: [alert.id] });
    }
  }
  return messages;
}

export async function sendPendingAlerts(options: NotifyOptions): Promise<NotifyResult> {
  const { db, webhookUrl } = options;
  const doFetch = options.fetch ?? globalThis.fetch;
  const now = (options.now ?? (() => Math.floor(Date.now() / 1000)))();
  const siteUrl = options.siteUrl?.replace(/\/+$/, "");

  if (!WEBHOOK_PATTERN.test(webhookUrl)) return { sent: 0, error: "the webhook address isn't a Discord webhook" };

  const pending = db
    .prepare<[number], PendingAlert>(`
      SELECT a.id, a.item_id AS itemId, i.name, a.direction, a.threshold, a.price
      FROM alerts a
      LEFT JOIN items i ON i.item_id = a.item_id
      WHERE a.notified_at IS NULL AND a.created_at > ?
      ORDER BY a.id
    `)
    .all(now - MAX_AGE_SECONDS);
  if (pending.length === 0) return { sent: 0 };

  const markSent = db.prepare<[number, number]>("UPDATE alerts SET notified_at = ? WHERE id = ?");
  let sent = 0;

  for (const message of intoMessages(pending, siteUrl)) {
    let problem: string | undefined;
    try {
      const response = await doFetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // allowed_mentions: an item name can never ping @everyone.
        body: JSON.stringify({ content: message.content, allowed_mentions: { parse: [] } }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) problem = `Discord answered ${response.status}`;
    } catch {
      // Deliberately not the error's own text: it can contain the address.
      problem = "could not reach Discord";
    }
    // Stop at the first failure. What was sent stays marked; the rest waits.
    if (problem) return { sent, error: problem };

    for (const id of message.ids) markSent.run(now, id);
    sent += message.ids.length;
  }
  return { sent };
}
