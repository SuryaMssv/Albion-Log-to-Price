# Albion Guild Loot Calculator

Paste an Albion Online guild chest log, value every stack at current market prices,
and split the total evenly between the players who ran the session.

**Chest log → parse → resolve item IDs → live market prices → total → equal split → Discord message**

Built to the spec in [`Albion_Guild_Loot_Valuation_Split_PRD.md`](./Albion_Guild_Loot_Valuation_Split_PRD.md).

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

Click **Load sample** to try the flow with the chest log from the PRD.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and serve |
| `npm test` | Vitest suite (108 tests) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run build:items` | Refresh `data/item-index.json` from the Albion binary dumps |

## How it works

Next.js App Router. The UI is a client component; the whole pipeline runs server-side
in one route handler, so no chest-log data reaches a third party except the market
price lookup itself. Nothing is stored — logs live only for the duration of the request.

```
app/
  page.tsx                 Server component shell
  api/calculate/route.ts   POST /api/calculate — rate limited, validated, stateless
components/
  LootCalculator.tsx       Form state, calls the API
  LogInput.tsx             Paste / upload / drag-drop / clipboard
  ResultsPanel.tsx         Totals, participant shares, Discord + CSV export
  ItemTable.tsx            Sortable item breakdown
  IssuesPanel.tsx          Everything excluded from the total
lib/
  parser.ts                Chest log → structured rows, then duplicate aggregation
  resolver.ts              Display name + enchantment → market item ID
  market.ts                AODP client: live prices + sales history
  calculator.ts            Valuation, total, equal split
  overrides.ts             Folds manually entered prices back into a result
  calculate.ts             Pipeline orchestration + input validation
  discord.ts / csv.ts      Output formats
data/item-index.json       Generated item metadata (5,337 display names)
scripts/build-item-index.mjs
tests/                     Parser, resolver, calculator, market, pipeline, overrides, rate limit
```

### Input format

The in-game copy format is the primary input:

```text
"Date" "Player" "Item" "Enchantment" "Quality" "Amount"
"08/18/2026 11:49:51" "DemiG0Dz" "Adept's Fiend Cowl" "2" "4" "1"
```

Tab- and comma-separated exports also parse, the header row is optional, and a header
with re-ordered columns is honoured. Blank lines are ignored; every other unparseable
row is reported with its line number and reason rather than dropped.

### Item resolution

Display names do not equal market API item IDs — `Adept's Fiend Cowl` is
`T4_HEAD_CLOTH_HELL`, and `Adept's Assassin Jacket` is `T4_ARMOR_LEATHER_SET3`. Rather
than hand-maintaining that mapping, `scripts/build-item-index.mjs` generates
`data/item-index.json` from the official [ao-bin-dumps](https://github.com/ao-data/ao-bin-dumps)
item list. The tier is already encoded in the display name (`Adept's` = T4), enchantment
is appended as `@N` at resolve time, and quality is passed to the API as a query
parameter. Re-run `npm run build:items` after an Albion patch adds items.

63 of ~5,300 display names are ambiguous (vendor trash, furniture, arena bags); the
resolver prefers the tradable, non-unique ID and reports the alternatives.

### Pricing

Prices come from the [Albion Online Data Project](https://www.albion-online-data.com/),
which is crowd-sourced from players running the data client — an item nobody has
recently seen in a market has no price. Requests are grouped by quality and batched,
so a whole chest log is usually one or two API calls.

**City is required.** Loot is valued in the city you pick — there is no default, since
the market changes every number on the page.

Pick a **price basis**; every row is labelled with the source it actually used, since the
basis falls back when it has no data.

| Basis | What it means | Watch out for |
|---|---|---|
| **Mid of listing range** (default) | Midpoint of the cheapest and dearest listing | A heuristic: the API exposes only min and max, not the distribution |
| **Lowest sell order** | Cheapest current listing — undercut it and the loot moves today | A single stale or mispriced listing drags the whole stack down |

The midpoint is the default because the cheapest listing is one entry and is routinely a
stale or mispriced outlier — Bridgewatch bags listed 9,685–31,255, where 9,685 valued the
stack at a third of what it was worth.

### Resolution order

Each stack takes the first tier that yields a price, and the row is badged with the tier
that won:

```
                          Item
                            |
          Selected city listing (chosen basis)  --> Sell order / Mid range
                            |  none
          Listings in all other markets         --> Global
                            |  none
          Recent sales, this city then others   --> Recent sales
                            |  none
          Officer types the in-game price       --> Manual
```

Tiers 2 and 3 take the **median** across contributing markets, so one dead market listing
at a silly price cannot carry a row — the markets used are named under it. Sales are
volume-weighted over a 14-day window.

Manual entry is always available, not only at the last tier: every unit price in the
breakdown is editable, and edits fold into the total, split and exports client-side.

### Catching bad prices

The two datasets corroborate each other, so the app can flag a price that looks wrong:

- **Wide listing range** — `sell_price_max` is shown next to `sell_price_min` when they
  differ by 2× or more. A real case: Bridgewatch bags listed 9,685–31,255, so the "lowest
  sell order" of 9,685 was one lone entry, and the officer could see ~27k in game.
- **Cross-check** — when the chosen price and the other source disagree by 1.5× or more,
  the comparison figure is shown under the row ("sold avg (380) 42,772").

Both are surfaced rather than auto-corrected: the app cannot know which figure is right,
but the officer looking at their own market screen can.

Why tier 2 matters: AODP prices only exist where a player has physically opened that
market in game while running the data client. On a sample of 12 common gank items, East
had a live sell order for 5 while West had all 12 — same item ids, so it is upstream
coverage, not a lookup problem. There is no alternative API to fall back on; Sandbox
Interactive publishes no market API, and the third-party price sites all resell AODP.

Buy orders are never used at any tier. A buy order is a standing offer, and a lowball one
(a 30k bid on a 200k item) is a trap for anyone who sells instantly — it is not what the
item is worth. For the same reason the Black Market is not selectable: it only ever buys.

One response covers every city, so when the selected market has no listing the app
reports where one does exist ("No sell order in Martlock. Cheapest elsewhere: 90,978 in
Bridgewatch") without letting that price into the total.

**Treat a market price as a snapshot, not a quote.** `sell_price_min` is the single
cheapest listing at the moment some player's client last had that market open — and an
underpriced item is the first thing to get bought. A "lowest sell order" from this morning
may be a listing that no longer exists, and one cheap outlier drags a whole stack down.

Rows carry their observation age and the breakdown flags anything past a threshold you
choose (1 / 2 / 6 / 24 hours, default 2). When a number looks wrong, type over it.

### Getting genuinely fresh prices

There is no query that makes AODP fresher — it is the freshest source there is, and the
sales-history endpoint lags further behind (20–44h vs 0.2–23h on a live sample). Freshness
is purely a function of who is uploading: the client can only report markets a player has
actually opened in game, and an upload is queryable immediately.

So for live prices on a quiet server, run the
[Albion Data Client](https://github.com/ao-data/albiondata-client/releases), open your
city's market in game, and hit Recalculate. Measured on East: median observation age 7h,
but the freshest was 12 minutes — that difference is somebody having browsed that market.
The app links this from the staleness warning.

Values are gross — no market tax, listing fee or repair cost is deducted.

### Items excluded from the total

Nothing is silently dropped. An item lands in one of two panels, and both are also
included in the CSV export:

- **Unresolved** — the name matched no Albion item (with "closest match" suggestions).
- **No price** — resolved, but neither a listing nor a recorded sale exists in the
  selected city. Shows the cheapest other market when there is one, offers an inline
  field to enter the in-game price, and is retryable. Never priced at zero.

### Splitting

`share = floor(total / participants)`. Albion trades whole silver, so any indivisible
remainder is reported separately rather than hidden — `333,333 each, 2 silver remainder`.

## Configuration

None required. Server (Asia/East default, Americas/West, Europe), city (required — no
default) and participant count are chosen in the UI.

## API

`POST /api/calculate` — 20 requests/minute per IP, 1 MB log limit, 5,000 row limit.

```jsonc
// request
{
  "log": "...raw Albion chest log...",
  "server": "east",              // east | west | europe
  "city": "Martlock",            // required: Caerleon | Bridgewatch | Fort Sterling |
                                 //   Lymhurst | Martlock | Thetford | Brecilien
  "price_basis": "sell_mid",     // optional; sell_mid (default) | sell_min
  "participants": 5,
  "participant_names": ["Player1", "Player2"]   // optional
}
```

```jsonc
// response (abridged)
{
  "totalValue": 163150,
  "participants": 5,
  "share": 32630,
  "remainder": 0,
  "participantShares": [{ "name": "Player 1", "share": 32630 }],
  "city": "Bridgewatch",
  "items": [{ "itemId": "T4_HEAD_CLOTH_HELL@2", "unitPrice": 90978, "totalValue": 90978,
              "city": "Bridgewatch", "priceDate": "2026-08-18T03:45:00", "stale": false,
              "source": "sell_order" },
             { "itemId": "T4_ARMOR_LEATHER_SET3@2", "unitPrice": 36004, "source": "recent_sale",
               "saleCount": 58, "priceDate": "2026-08-10T00:00:00" }],
  "unresolvedItems": [],
  "missingPrices": [{ "itemId": "T4_BAG@1", "reason": "No sell order in Bridgewatch...",
                      "elsewhere": { "city": "Lymhurst", "price": 6345 } }],
  "parseErrors": [],
  "warnings": [],
  "stats": { "rowsParsed": 8, "stacks": 8, "itemsPriced": 5, "marketMs": 641 }
}
```

Errors return `{ "error": "..." }` with 400 (bad input), 413 (too large), 429 (rate
limited), 502 (market unavailable) or 500.

## Not included

Deliberately out of MVP scope, per the PRD: weighted shares, tax/repair deductions,
saved sessions, and the Discord bot.
