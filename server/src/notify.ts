import type { Db } from "./db.js";

// Sends unsent watchlist alerts to Discord through a webhook.
// The webhook address is a secret: it lives only in .env and is never logged.
// Alerts stay unsent in the database until Discord accepts them.

// Only ever post to Discord itself.
export const WEBHOOK_PATTERN = /^https:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[\w-]+$/;

// Older alerts are stale and are left unsent.
const MAX_AGE_SECONDS = 6 * 60 * 60;
// Discord's limit is 2000 characters.
const MAX_MESSAGE_LENGTH = 1900;

export interface NotifyOptions {
  db: Db;
  webhookUrl: string;
  // Makes item names links.
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

// 123456 -> "12g 34s 56c"; zero parts are left out.
export function formatCopper(copper: number): string {
  const gold = Math.floor(copper / 10_000);
  const silver = Math.floor((copper % 10_000) / 100);
  const rest = copper % 100;
  const parts = [gold > 0 ? `${gold}g` : "", silver > 0 ? `${silver}s` : "", rest > 0 ? `${rest}c` : ""];
  return parts.filter(Boolean).join(" ") || "0c";
}

export function alertLine(alert: PendingAlert, siteUrl?: string): string {
  const label = alert.name ?? `Item #${alert.itemId}`;
  // <...> stops Discord adding a link preview.
  const item = siteUrl ? `[**${label}**](<${siteUrl}/item/${alert.itemId}>)` : `**${label}**`;
  return alert.direction === "below"
    ? `📉 ${item} is down to **${formatCopper(alert.price)}** (alert: ${formatCopper(alert.threshold)} or less)`
    : `📈 ${item} is up to **${formatCopper(alert.price)}** (alert: ${formatCopper(alert.threshold)} or more)`;
}

// As few messages as fit the length limit.
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
        // Item names can never ping anyone.
        body: JSON.stringify({ content: message.content, allowed_mentions: { parse: [] } }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) problem = `Discord answered ${response.status}`;
    } catch {
      // Not the error's own text: it can contain the address.
      problem = "could not reach Discord";
    }
    // Stop at the first failure; the rest waits for the next run.
    if (problem) return { sent, error: problem };

    for (const id of message.ids) markSent.run(now, id);
    sent += message.ids.length;
  }
  return { sent };
}
