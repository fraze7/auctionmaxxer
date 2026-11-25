# auctionmaxxer

A personal auction-house tracker for World of Warcraft: Forever. A collector
on a VPS stores hourly price snapshots from Blizzard's API; a web app turns
them into tabs for finding deals, planning profession levelling, and so on.
One user, one auction house (house 113, Horde), behind a login.

Notes for whoever works on the project next.

## Layout

```
server/            Node 24 + TypeScript (ESM), better-sqlite3, Express 5, zod 4
  migrations/      001..009, applied in name order on start
  src/             one module per feature, each with a .test.ts beside it
  src/professions/ recipe data per profession
web/               React 19, Vite 8, Tailwind 4, react-router, TanStack Query
  src/pages/       one file per tab
  src/api.ts       response types and one function per endpoint
deploy/            systemd units, Caddyfile, deploy.sh and setup scripts
```

Server modules: `collector`/`job`/`scheduler` (fetch and store snapshots),
`backfill` (item names and vendor prices), `deals`, `favor` + `crates`,
`watchlist` + `notify` (Discord), `levelling`, `crafts`, `vendor`,
`resets`, `liquidity`, `hours`, `api` (all routes), `settings`, `retention`, `backup`.

## Commands

```bash
cd server && npm test          # node:test via tsx; 250 tests
cd server && npx tsc --noEmit
cd web && npm run build        # tsc -b && vite build
cd web && npm run lint         # oxlint; a few known warnings
bash deploy/deploy.sh auctionmaxxer   # ships committed HEAD only
bash deploy/pull-backup.sh auctionmaxxer   # fetch last night's DB backup
```

There is no formatter config. If you run prettier, use `--print-width 120`
(and `--no-semi --single-quote` for `web/`).

To view the site locally with real data: copy the live DB (a backup, or
`better-sqlite3`'s `.backup()` over ssh), start the API with `DB_PATH`
pointing at the copy (`npm run api`, port 3001), and run `npm run dev` in
`web/` (port 5173, proxies `/api`).

## Data model

- `snapshots`: one row per fetch, always `kind = 'commodities'`; single-item
  listings from the same fetch hang off the same row.
- `commodity_prices`: per snapshot and item: min, median, quantity, units at
  min, listing count. Kept forever.
- `price_levels`: the 20 cheapest price levels per item. Kept 14 days.
- `item_prices`: cheapest and median buyout per item for listings sold one
  at a time (gear, bags, patterns), from 15 Nov 2026. Kept 14 days. Such
  items have `items.kind = 'single'` and are left out of the plain Items
  list, but a search finds them (gear since 24 Nov 2026, when the owner could
  not find Skullflame Shield). They get a shorter item page: price and
  listings only, no alerts or time of day.
  Levelling uses it for plan prices (`plans.ts`, matched by name: "Plans:
  X", "Pattern: X", "Formula: X"); Crafts uses it to price crafted gear.
- `items`: name, quality, `sell_price` (what a vendor pays; NULL = not
  looked up yet, 0 = none). Looked up in Blizzard's `static-forever-eu`
  catalogue, then `static-classic1x-eu`, which has some Classic items
  Forever's lacks (Rockshard Pellets, Precision Arrow). Items new to
  Forever are often in neither; they stay `missing` and are retried weekly.
- `recommendations`: each snapshot's top Deals and Resets picks, saved by
  the collector for the Record tab.
- `tab_alert_rules`, `tab_alerts`: a minimum profit per tab, and the alerts
  raised from it.
- `character_skills`: the owner's professions and skill levels (the
  Character tab). Levelling starts from them, Crafts and Crafts alerts only
  show what the character can make.
- `settings`, `watches`, `alerts`.

Prices are whole copper; times are Unix seconds.

## Tabs

| Tab | What it shows | Server module |
|---|---|---|
| Deals | items priced well under their 24h/7d median, unless more than twice the usual stock is listed (`deal_max_stock_ratio`; from a week of Record verdicts, 15-21 Nov 2026, where such picks lost money) | `deals.ts` |
| Items | what is listed now, most listings first; a search also finds unlisted items. Item page with chart, price alert and time-of-day pattern | `api.ts`, `hours.ts` |
| Deals, Resets view | buyouts that leave a much higher cheapest price (`?show=resets`) | `resets.ts` |
| Vendor | items listed below what a vendor pays | `vendor.ts` |
| Favor | cheapest Waylaid Crates for Merchant's Favor, plus the crates' cheapest and dearest four hours of the last week when odd and even days agree (`groupHours`) | `favor.ts`, `crates.ts`, `hours.ts` |
| Crafts | profit per craft at current prices, for every recipe a trainer or vendor teaches or that has been seen for sale on the auction house (with its price), Cooking included | `crafts.ts`, `professions/catalogue.ts` |
| Levelling | cheapest 1-300 route per profession | `levelling.ts` |
| Record | how Deals and Resets picks turned out a day later (only picks a day old are listed) | `record.ts` |
| Watchlist | price rules and per-tab alerts, sent through Discord | `watchlist.ts`, `tabAlerts.ts`, `notify.ts` |

The header groups the tabs: Buy now (Deals, Vendor, Record),
Professions (Crafts, Levelling, Favor), then Items, Watchlist and
Character on their own (`GROUPS` in `web/src/App.tsx`).

On a phone (below Tailwind's `md`, 768px) `DataTable` shows each row as a
card with a "Sort by" menu, and `Picker` (the profession buttons on Crafts
and Levelling) wraps into separate buttons. Check new pages at 375px wide.

Filters live in the URL (`useUrlParam`), with `replace` so they add no Back
steps. The item page's back link returns to the tab you came from.

### Levelling planner (`levelling.ts`)

- Skill-up chance: 1 below yellow, then `(grey - skill) / (grey - yellow)`.
  This is the Classic formula; not confirmed for Forever.
- Pass 1 picks the cheapest recipe per skill point, pricing the full quantity
  needed. `groupAlternating` then turns "bolt, cloak, bolt, cloak" into two
  steps. Pass 2 groups points into steps (split at 150 and 225) and prices
  them exactly from the order book. The page joins one recipe split at
  150 or 225 back into one row (`joinSplitSteps`).
- `absorbShortSteps` folds a step of five points or fewer into a neighbour
  when that costs at most 25% more for those points (pass 1 prices).
- If a step cannot be bought in full, it is shortened and the planner
  re-plans from there with other recipes.
- A reagent the profession can craft (grinding stones, bolts, leather) is
  priced from its own inputs unless buying is cheaper. One level deep.
- The route stops when a point would cost over ten times the dearest so far
  (`PRICE_JUMP`). A flat chance cutoff was tested and breaks every route.
- `Profession.helper` + `withHelper`: the "I have Mining" option prices bars
  from ore for Blacksmithing and Engineering (`professions/mining.ts`).
- Each step carries `stops`: its cost if it ended early, every five points.
  The page uses them for the "stopping at skill N costs" line (the shortest
  final stretch, within 25 points, holding a third of the total).
- Recipes are chosen by cost less what a vendor pays for the product
  (`sellPrices` from `items.sell_price`; never auction prices), credited at
  most 80% of the cost (`SALE_CREDIT`), so break-even crafts never look
  free. Products another recipe uses are not counted as sold. Steps show
  this as "back"; the totals stay what you spend. Found when the owner saw
  Hillman's Cloak beat Heavy Armor Kit at 135-150 in game.
- Trainer fees and plan prices are left out.

Professions: Alchemy, Blacksmithing, Tailoring, Leatherworking, Engineering,
Enchanting, Mining. Mining (`SMELTING` in `professions/mining.ts`) is there
for Crafts, to show which ores pay to smelt; its route is short: smelting
gives skill only to 185, and 140-155 is a free "mine ore nodes" step
(spell 0). Coal is priced at 4s05c, what the owner pays a vendor. The
helper `MINING` keeps Bronze and Steel written from ore, since a helper is
only looked up one level deep. Mining counts in the profile like any other
profession, so a Mining-only character sees only smelts in Crafts. Trainer recipes stop short of 300 for some, so a few vendor
plans are included and flagged `plan`. Blacksmithing also has fourteen dropped
plans, which the owner buys on the auction house; plan prices come from
`item_prices`. The five Imperial Plate
plans come from quests in Gadgetzan. Tailoring, Leatherworking and
Enchanting have a few dropped recipes for the top of the route (Wowhead
source 2 = drop; the owner confirmed drops are sold on the auction house).
A plan step has a "skip" link: `?skip=<spell ids>` re-plans without them.
A dropped plan nobody has listed in the stored history is left out
automatically (`unavailable` in the response; `plans.ts`). Nine plans new
to Forever are matched by item ID (`PLAN_ITEMS`) because they had never
been listed, so their names were unknown. Each data file's header comment says
which were checked in game.

### Recipe catalogue (Crafts)

`professions/catalogue.json` holds every recipe that makes an item for the six
crafting professions and Cooking, from Wowhead's list pages (22 Nov 2026):
`[spell, name, learn, yellow, grey, item, quantity, reagents, source]`,
source `t` trainer, `v` vendor, `b` bought from players (drops and the rest).
Specialisation recipes are left out. `CRAFT_PROFESSIONS` (Crafts, Crafts
alerts, the Character tab) adds it to each profession; Levelling keeps its
own lists. A `b` recipe only shows once its recipe item has been seen on the
auction house, matched by name (`recipeKey` in `plans.ts`). Cooldown crafts
(`COOLDOWNS` in `crafts.ts`) count as one craft. To rebuild the file, save
each list page's `listviewspells` as JSON (the browser pane cannot `fetch`
to localhost from Wowhead, but a form POST to a local receiver works) and
convert it.

### Adding or fixing recipe data

Open `https://www.wowhead.com/forever/spells/professions/<name>` in a browser
and read `window.listviewspells` (colors = orange/yellow/green/grey,
reagents, creates, source: 6 = trainer, 5 = vendor, `specialization` set for
specialisation recipes) and `window.g_items` for names. Pull everything from
that one page first: Wowhead shows a human-verification page after a few
dozen scripted page loads, and that must not be bypassed. Before including a
plan, check it needs neither reputation nor a specialisation; the new
Forever plans usually need one. `g_items` buy prices exist on non-vendor
items too, so they do not prove an item is vendor-sold.

### Liquidity (`liquidity.ts`)

Blizzard reports no sales. `estimateSales` counts units that vanish from the
cheap end of the order book between consecutive snapshots over three days.
Good for ranking, rough as a number: it misses sales within the hour and
counts cancellations and buyouts as sales. Shown on Deals, Resets and Crafts
as a band (fast, steady, slow, none seen; `web/src/components/SellRate.tsx`)
with the number on hover.

## Known limits and open questions

- Crafts sells a stackable product to a vendor when that pays more than the
  auction house after its cut (`saleTo: 'vendor'`); then no day's-sales
  limit applies, so `count` can reach `MAX_COUNT` (1000).
- Crafted gear is priced in Crafts (`kind: 'gear'`) from its cheapest listing
  or its vendor price, one craft at a time, with no sell-rate estimate. With
  fewer than three listings (`MIN_GEAR_LISTINGS`) the listings are ignored
  and the vendor price is used, so rare new gear can look like a loss.
- Vendor covers commodities only. Gear below vendor price was checked on 16
  Nov 2026 and left out: the biggest gap in a day of history was 4 silver.
- The item page's time-of-day chart (`hours.ts`) only names cheap and dear
  hours when odd and even days agree (`repeats`, correlation 0.6 or more).
  With a few days of history most items fail that. As a group, Waylaid Crates
  were cheaper in the evening than the daytime on every day from 13 to 21 Nov,
  though the gap halved over that time; the Favor tab shows it while it holds.
- Crafts does not check reputation: Blizzard's item data shows the skill and
  specialisation a recipe needs but not reputation (checked 22 Nov 2026 on
  Timbermaw and Argent Dawn patterns), so faction recipes show up as if anyone
  could learn them.
- The skill-up formula and some vendor prices are from Classic or Wowhead,
  not confirmed in game.
- The economy is days old, so price swings are large and totals for the top
  of each levelling route are high. The owner expects these to settle.
- SQL note: better-sqlite3 here rejects reused `?1` parameters; use named
  `@param` ones.

## Ideas not started

A settings editor (thresholds
live in the `settings` table); a Mining-style helper for other gathering
professions. Checked 17 Nov 2026 and left alone: routes still step aside
for a few points (Engineering's Dense Blasting Powder at 250-258,
Blacksmithing's Dense Weightstone at 225-235) because the detour is far
cheaper than staying on the main recipe.
