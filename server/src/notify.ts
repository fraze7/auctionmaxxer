import type { Db } from "./db.js";
import type { TabKind } from "./tabAlerts.js";

// Sends unsent watchlist and tab alerts to Discord through a webhook.
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

interface PendingTabAlert {
  id: number;
  kind: TabKind;
  itemId: number;
  name: string | null;
  profit: number;
}

// 123456 -> "12g 34s 56c"; zero parts are left out.
export function formatCopper(copper: number): string {
  const gold = Math.floor(copper / 10_000);
  const silver = Math.floor((copper % 10_000) / 100);
  const rest = copper % 100;
  const parts = [gold > 0 ? `${gold}g` : "", silver > 0 ? `${silver}s` : "", rest > 0 ? `${rest}c` : ""];
  return parts.filter(Boolean).join(" ") || "0c";
}

// <...> around a link stops Discord adding a preview.
function itemLink(itemId: number, name: string | null, siteUrl?: string): string {
  const label = name ?? `Item #${itemId}`;
  return siteUrl ? `[**${label}**](<${siteUrl}/item/${itemId}>)` : `**${label}**`;
}

export function alertLine(alert: PendingAlert, siteUrl?: string): string {
  const item = itemLink(alert.itemId, alert.name, siteUrl);
  return alert.direction === "below"
    ? `📉 ${item} is down to **${formatCopper(alert.price)}** (alert: ${formatCopper(alert.threshold)} or less)`
    : `📈 ${item} is up to **${formatCopper(alert.price)}** (alert: ${formatCopper(alert.threshold)} or more)`;
}

const TAB_WORDING: Record<TabKind, { tab: string; path: string; text: string }> = {
  deal: { tab: "Deals", path: "", text: "is a deal worth about" },
  reset: { tab: "Resets", path: "resets", text: "can be reset for about" },
  vendor: { tab: "Vendor", path: "vendor", text: "is below vendor price, worth" },
  craft: { tab: "Crafts", path: "crafts", text: "is worth crafting for about" },
};

export function tabAlertLine(alert: PendingTabAlert, siteUrl?: string): string {
  const { tab, path, text } = TAB_WORDING[alert.kind];
  const where = siteUrl ? `[${tab}](<${siteUrl}/${path}>)` : tab;
  return `💰 ${where}: ${itemLink(alert.itemId, alert.name, siteUrl)} ${text} **${formatCopper(alert.profit)}**`;
}

// One line of a message, and how to mark it sent.
interface Outgoing {
  line: string;
  markSent: () => void;
}

// As few messages as fit the length limit.
function intoMessages(lines: Outgoing[]): Array<{ content: string; lines: Outgoing[] }> {
  const messages: Array<{ content: string; lines: Outgoing[] }> = [];
  for (const outgoing of lines) {
    const last = messages.at(-1);
    if (last && last.content.length + 1 + outgoing.line.length <= MAX_MESSAGE_LENGTH) {
      last.content += `\n${outgoing.line}`;
      last.lines.push(outgoing);
    } else {
      messages.push({ content: outgoing.line, lines: [outgoing] });
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
  const pendingTabs = db
    .prepare<[number], PendingTabAlert>(`
      SELECT a.id, a.kind, a.item_id AS itemId, i.name, a.profit
      FROM tab_alerts a
      LEFT JOIN items i ON i.item_id = a.item_id
      WHERE a.notified_at IS NULL AND a.created_at > ?
      ORDER BY a.id
    `)
    .all(now - MAX_AGE_SECONDS);
  if (pending.length + pendingTabs.length === 0) return { sent: 0 };

  const markSent = db.prepare<[number, number]>("UPDATE alerts SET notified_at = ? WHERE id = ?");
  const markTabSent = db.prepare<[number, number]>("UPDATE tab_alerts SET notified_at = ? WHERE id = ?");
  const outgoing: Outgoing[] = [
    ...pending.map((alert) => ({
      line: alertLine(alert, siteUrl),
      markSent: () => void markSent.run(now, alert.id),
    })),
    ...pendingTabs.map((alert) => ({
      line: tabAlertLine(alert, siteUrl),
      markSent: () => void markTabSent.run(now, alert.id),
    })),
  ];
  let sent = 0;

  for (const message of intoMessages(outgoing)) {
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

    for (const line of message.lines) line.markSent();
    sent += message.lines.length;
  }
  return { sent };
}
