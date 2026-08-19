import { SERVERS, type City, type ServerId } from "./types";

/**
 * Albion Online Data Project client (FR-05).
 *
 * AODP returns one row per item / quality / city, so a single request can cover a
 * whole chest log. Valuation uses the lowest sell order in the market the officer
 * selected (FR-06) — the price the loot would actually list and move at there.
 *
 * Every city comes back in the same response, so the cheapest order *outside* the
 * selected market is folded at the same time. It never enters the total; it only lets
 * the UI say where a price exists when the selected market has none.
 */

const CHUNK_SIZE = 60;
/** History responses carry a series per city/quality, so batches stay smaller. */
const HISTORY_CHUNK_SIZE = 30;
/** How far back a completed sale still counts as evidence of value. */
export const HISTORY_WINDOW_DAYS = 14;
const TIMEOUT_MS = 15_000;
const RETRIES = 1;
const CONCURRENCY = 2;
const USER_AGENT = "albion-guild-loot-calculator/1.0 (guild loot valuation tool)";

/**
 * Prices older than this are still used, but flagged in the UI.
 *
 * Deliberately short. A market price is a snapshot of the cheapest listing at the moment
 * some player's data client last had that market open — and an underpriced item is the
 * first thing to get bought. On a quiet server a "lowest sell order" from this morning
 * can easily be a listing that no longer exists.
 *
 * This is the default for API consumers; the UI lets the officer pick their own
 * threshold, since what counts as "current" depends on how liquid the item is.
 */
export const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

/**
 * The Black Market is a one-way NPC sink that only ever buys, at lowball buy-order
 * prices. It can never answer "what is this selling for", so it is excluded outright.
 */
const EXCLUDED_CITIES = new Set(["black market"]);

/** AODP's "no data" sentinel timestamp. */
const EMPTY_DATE_PREFIX = "0001-01-01";

export interface AodpRow {
  item_id: string;
  city: string;
  quality: number;
  sell_price_min: number;
  sell_price_min_date: string;
  sell_price_max: number;
  buy_price_max: number;
  buy_price_max_date: string;
}

export interface PriceQuote {
  /** Cheapest current listing. */
  price: number;
  /** Dearest current listing, when the market reported one. */
  maxPrice?: number;
  city: string;
  date: string;
}

export interface MarketRequestItem {
  itemId: string;
  quality: number;
}

export interface HistoryQuote {
  /** Volume-weighted average of every completed sale in the window. */
  price: number;
  city: string;
  /** Timestamp of the most recent bucket that contributed. */
  date: string;
  /** Total units sold across the window. */
  saleCount: number;
}

export interface HistoryLookup {
  /** Sales average in the selected city, keyed like `quotes`. */
  sales: Map<string, HistoryQuote>;
  /** Sales averages in every other city, used when the selected one has none. */
  elsewhere: Map<string, HistoryQuote[]>;
  warnings: string[];
}

export interface MarketLookup {
  /** Lowest sell order in the selected city, keyed by `${itemId}|${quality}`. */
  quotes: Map<string, PriceQuote>;
  /** Every other city's listing, used when the selected city has none. */
  elsewhere: Map<string, PriceQuote[]>;
  warnings: string[];
  /** True when every request failed — the caller should surface a retry prompt. */
  totalFailure: boolean;
}

export class MarketApiError extends Error {}

export function quoteKey(itemId: string, quality: number): string {
  return `${itemId}|${quality}`;
}

/** Injectable for tests. */
export type Fetcher = typeof fetch;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function fetchWithRetry(url: string, fetcher: Fetcher): Promise<AodpRow[]> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const response = await fetcher(url, {
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
      if (response.status === 429) {
        throw new MarketApiError("Market API rate limit reached.");
      }
      if (!response.ok) {
        throw new MarketApiError(`Market API returned ${response.status} ${response.statusText}.`);
      }
      const data = await response.json();
      if (!Array.isArray(data)) throw new MarketApiError("Market API returned an unexpected payload.");
      return data as AodpRow[];
    } catch (error) {
      lastError = error;
      if (attempt < RETRIES) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new MarketApiError("Market API request failed.");
}

/** AODP history takes US-style `M-D-YYYY` dates. */
function formatHistoryDate(date: Date): string {
  return `${date.getUTCMonth() + 1}-${date.getUTCDate()}-${date.getUTCFullYear()}`;
}

export function buildHistoryUrl(
  server: ServerId,
  itemIds: string[],
  qualities: number[],
  now: Date,
): string {
  const base = SERVERS[server].api;
  const ids = itemIds.map((id) => encodeURIComponent(id)).join(",");
  const quality = [...new Set(qualities)].sort((a, b) => a - b).join(",");
  const start = new Date(now.getTime() - HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return (
    `${base}/api/v2/stats/history/${ids}` +
    `?date=${formatHistoryDate(start)}&end_date=${formatHistoryDate(now)}` +
    `&qualities=${quality}&time-scale=24`
  );
}

/** Runs tasks with a small concurrency cap so we stay well inside AODP rate limits. */
async function mapLimit<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await task(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** A row is usable only if it carries a real, dated sell order. */
function sellQuote(row: AodpRow): PriceQuote | null {
  if (EXCLUDED_CITIES.has(row.city.trim().toLowerCase())) return null;
  if (!row.sell_price_min || row.sell_price_min <= 0) return null;
  if (row.sell_price_min_date.startsWith(EMPTY_DATE_PREFIX)) return null;
  return {
    price: row.sell_price_min,
    maxPrice: row.sell_price_max > row.sell_price_min ? row.sell_price_max : undefined,
    city: row.city,
    date: row.sell_price_min_date,
  };
}

function keepCheaper(map: Map<string, PriceQuote>, key: string, quote: PriceQuote): void {
  const current = map.get(key);
  if (!current || quote.price < current.price) map.set(key, quote);
}

export interface FoldedRows {
  quotes: Map<string, PriceQuote>;
  elsewhere: Map<string, PriceQuote[]>;
}

/**
 * Splits rows into the selected city's listing and every other city's listing. AODP
 * returns one row per city, so the "elsewhere" list holds at most one entry per market.
 */
export function foldRows(rows: AodpRow[], city: City): FoldedRows {
  const quotes = new Map<string, PriceQuote>();
  const elsewhere = new Map<string, PriceQuote[]>();

  for (const row of rows) {
    const quote = sellQuote(row);
    if (!quote) continue;
    const key = quoteKey(row.item_id, row.quality);
    if (row.city === city) {
      keepCheaper(quotes, key, quote);
    } else {
      const others = elsewhere.get(key);
      if (others) others.push(quote);
      else elsewhere.set(key, [quote]);
    }
  }

  return { quotes, elsewhere };
}

export function buildRequestUrl(
  server: ServerId,
  itemIds: string[],
  qualities: number[],
): string {
  const base = SERVERS[server].api;
  const ids = itemIds.map((id) => encodeURIComponent(id)).join(",");
  const quality = [...new Set(qualities)].sort((a, b) => a - b).join(",");
  return `${base}/api/v2/stats/prices/${ids}?qualities=${quality}`;
}

/**
 * Fetches market prices for the requested (item, quality) pairs. Requests are
 * grouped by quality so we never ask for combinations the log does not contain.
 *
 * Cities are not filtered server-side: one response covers every market, which costs
 * nothing extra and lets us report where a price exists when `city` has none.
 */
interface AodpHistorySeries {
  location: string;
  item_id: string;
  quality: number;
  data: { item_count: number; avg_price: number; timestamp: string }[];
}

async function fetchHistoryWithRetry(url: string, fetcher: Fetcher): Promise<AodpHistorySeries[]> {
  const rows = (await fetchWithRetry(url, fetcher)) as unknown as AodpHistorySeries[];
  return rows;
}

/**
 * Second price source: completed sales from AODP's history endpoint.
 *
 * The live-price endpoint only knows about listings a player has physically opened in
 * game while running the data client, which leaves large gaps on quieter servers. A
 * recorded sale is independent evidence of what an item actually changed hands for, so
 * it fills those gaps — always flagged as such, never mixed silently into sell orders.
 */
export async function fetchSalesHistory(
  items: MarketRequestItem[],
  server: ServerId,
  city: City,
  fetcher: Fetcher = fetch,
  now: Date = new Date(),
): Promise<HistoryLookup> {
  const sales = new Map<string, HistoryQuote>();
  const elsewhere = new Map<string, HistoryQuote[]>();
  const warnings: string[] = [];
  if (items.length === 0) return { sales, elsewhere, warnings };

  const byQuality = new Map<number, Set<string>>();
  for (const item of items) {
    let ids = byQuality.get(item.quality);
    if (!ids) byQuality.set(item.quality, (ids = new Set()));
    ids.add(item.itemId);
  }

  const requests: { url: string; count: number }[] = [];
  for (const [quality, ids] of byQuality) {
    for (const group of chunk([...ids], HISTORY_CHUNK_SIZE)) {
      requests.push({ url: buildHistoryUrl(server, group, [quality], now), count: group.length });
    }
  }

  const responses = await mapLimit(requests, CONCURRENCY, async (request) => {
    try {
      return await fetchHistoryWithRetry(request.url, fetcher);
    } catch (error) {
      warnings.push(
        `Sales history lookup failed for ${request.count} item(s): ${error instanceof Error ? error.message : "unknown error"}`,
      );
      return null;
    }
  });

  // Weight every bucket by units sold: six bags at 23k should outweigh one at 9k.
  const totals = new Map<string, { value: number; units: number; latest: string; city: string }>();
  for (const series of responses) {
    if (!series) continue;
    for (const entry of series) {
      const key = `${quoteKey(entry.item_id, entry.quality)}@@${entry.location}`;
      for (const bucket of entry.data ?? []) {
        if (!bucket.avg_price || bucket.avg_price <= 0 || !bucket.item_count) continue;
        const running = totals.get(key) ?? { value: 0, units: 0, latest: "", city: entry.location };
        running.value += bucket.avg_price * bucket.item_count;
        running.units += bucket.item_count;
        if (bucket.timestamp > running.latest) running.latest = bucket.timestamp;
        totals.set(key, running);
      }
    }
  }

  for (const [compound, total] of totals) {
    if (total.units === 0) continue;
    // The Black Market only ever buys, so its "sales" are not a selling price.
    if (EXCLUDED_CITIES.has(total.city.trim().toLowerCase())) continue;

    const key = compound.slice(0, compound.lastIndexOf("@@"));
    const quote: HistoryQuote = {
      price: Math.round(total.value / total.units),
      city: total.city,
      date: total.latest,
      saleCount: total.units,
    };

    if (total.city === city) {
      sales.set(key, quote);
    } else {
      const others = elsewhere.get(key);
      if (others) others.push(quote);
      else elsewhere.set(key, [quote]);
    }
  }

  return { sales, elsewhere, warnings };
}

export async function fetchPrices(
  items: MarketRequestItem[],
  server: ServerId,
  city: City,
  fetcher: Fetcher = fetch,
): Promise<MarketLookup> {
  const quotes = new Map<string, PriceQuote>();
  const elsewhere = new Map<string, PriceQuote[]>();
  const warnings: string[] = [];

  if (items.length === 0) return { quotes, elsewhere, warnings, totalFailure: false };

  const byQuality = new Map<number, Set<string>>();
  for (const item of items) {
    let ids = byQuality.get(item.quality);
    if (!ids) byQuality.set(item.quality, (ids = new Set()));
    ids.add(item.itemId);
  }

  const requests: { url: string; count: number }[] = [];
  for (const [quality, ids] of byQuality) {
    for (const group of chunk([...ids], CHUNK_SIZE)) {
      requests.push({ url: buildRequestUrl(server, group, [quality]), count: group.length });
    }
  }

  let failed = 0;
  const responses = await mapLimit(requests, CONCURRENCY, async (request) => {
    try {
      return await fetchWithRetry(request.url, fetcher);
    } catch (error) {
      failed++;
      warnings.push(
        `Market lookup failed for ${request.count} item(s): ${error instanceof Error ? error.message : "unknown error"}`,
      );
      return null;
    }
  });

  for (const rows of responses) {
    if (!rows) continue;
    const folded = foldRows(rows, city);
    for (const [key, quote] of folded.quotes) keepCheaper(quotes, key, quote);
    for (const [key, others] of folded.elsewhere) {
      const existing = elsewhere.get(key);
      if (existing) existing.push(...others);
      else elsewhere.set(key, [...others]);
    }
  }

  return { quotes, elsewhere, warnings, totalFailure: failed > 0 && failed === requests.length };
}
