import { STALE_AFTER_MS, quoteKey, type HistoryLookup, type MarketLookup } from "./market";
import type {
  City,
  MissingPriceItem,
  ParticipantShare,
  PriceBasis,
  PriceSource,
  PricedItem,
  ResolvedEntry,
} from "./types";

/** Item value = unit price x amount, in whole silver (FR-07, PRD §14). */
export function itemValue(unitPrice: number, amount: number): number {
  return Math.round(unitPrice) * amount;
}

export interface PricingResult {
  priced: PricedItem[];
  missing: MissingPriceItem[];
}

const EMPTY_HISTORY: HistoryLookup = { sales: new Map(), elsewhere: new Map(), warnings: [] };

/** Flag a listing range this lopsided — the cheap end is probably an outlier. */
const WIDE_SPREAD_RATIO = 2;
/** Flag a chosen price this far from the corroborating figure. */
const CROSS_CHECK_RATIO = 1.5;

interface Candidate {
  price: number;
  source: PriceSource;
  date: string;
  city: string;
  /** Markets behind a global price. */
  markets?: string[];
}

/** The listing price for one city under the chosen basis. */
function listingPrice(basis: PriceBasis, quote: { price: number; maxPrice?: number }): number {
  return basis === "sell_mid" && quote.maxPrice
    ? Math.round((quote.price + quote.maxPrice) / 2)
    : quote.price;
}

/** Median resists one dead market listing at a silly price, in either direction. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle];
}

/**
 * Picks the unit price for one stack according to the chosen basis, falling back
 * through the other sources rather than dropping the item.
 *
 * Resolution order, first hit wins:
 *
 *   1. the selected city's listing, under the chosen basis
 *   2. listings in every other market, median of their basis prices
 *   3. a volume-weighted average of recent completed sales, this city then others
 *   4. nothing — the row goes to manual entry
 *
 * `sell_min` is the cheapest single listing; `sell_mid` splits the listing range, which
 * ignores a lone underpriced entry. Each candidate reports the source it came from so
 * the row can say so.
 */
function chooseCandidate(
  basis: PriceBasis,
  listing: { price: number; maxPrice?: number; city: string; date: string } | undefined,
  globalListings: { price: number; maxPrice?: number; city: string; date: string }[],
  sale: { price: number; city: string; date: string } | undefined,
  globalSales: { price: number; city: string; date: string }[] = [],
): Candidate | undefined {
  if (listing) {
    const price = listingPrice(basis, listing);
    return {
      price,
      source: basis === "sell_mid" && listing.maxPrice ? "sell_mid" : "sell_order",
      date: listing.date,
      city: listing.city,
    };
  }

  if (globalListings.length > 0) {
    return {
      price: median(globalListings.map((quote) => listingPrice(basis, quote))),
      source: "global",
      // Freshest contributing observation, so the age shown is not pessimistic.
      date: globalListings.reduce((latest, quote) => (quote.date > latest ? quote.date : latest), ""),
      city: globalListings[0].city,
      markets: globalListings.map((quote) => quote.city).sort(),
    };
  }

  if (sale) {
    return { price: sale.price, source: "recent_sale", date: sale.date, city: sale.city };
  }

  if (globalSales.length > 0) {
    return {
      price: median(globalSales.map((quote) => quote.price)),
      source: "recent_sale",
      date: globalSales.reduce((latest, quote) => (quote.date > latest ? quote.date : latest), ""),
      city: globalSales[0].city,
      markets: globalSales.map((quote) => quote.city).sort(),
    };
  }

  return undefined;
}

/**
 * Prices resolved stacks against the selected city, preferring a live sell order and
 * falling back to a recent completed sale where no listing has been reported (FR-16).
 * An item listed only in another city is reported as a hint, never counted.
 */
export function priceEntries(
  entries: ResolvedEntry[],
  lookup: MarketLookup,
  city: City,
  options: { history?: HistoryLookup; now?: number; basis?: PriceBasis } = {},
): PricingResult {
  const history = options.history ?? EMPTY_HISTORY;
  const now = options.now ?? Date.now();
  const basis = options.basis ?? "sell_mid";
  const priced: PricedItem[] = [];
  const missing: MissingPriceItem[] = [];

  for (const entry of entries) {
    const key = quoteKey(entry.itemId, entry.quality);
    const listing = lookup.quotes.get(key);
    const globalListings = lookup.elsewhere.get(key) ?? [];
    const sale = history.sales.get(key);
    const globalSales = history.elsewhere.get(key) ?? [];
    const quote = chooseCandidate(basis, listing, globalListings, sale, globalSales);

    if (!quote) {
      // Nothing left to try: no listing here, none anywhere, and no recorded sale.
      missing.push({
        itemId: entry.itemId,
        name: entry.name,
        enchantment: entry.enchantment,
        quality: entry.quality,
        amount: entry.amount,
        players: entry.players,
        reason: lookup.totalFailure
          ? "Market data was unavailable for this request."
          : `No listing and no recorded sale in any market for this item at quality ${entry.quality}.`,
      });
      continue;
    }

    const unitPrice = Math.round(quote.price);
    const parsedDate = Date.parse(quote.date.endsWith("Z") ? quote.date : `${quote.date}Z`);

    // Corroborate the chosen figure against the other source, and only surface the
    // comparison when the two genuinely disagree.
    let crossCheck: PricedItem["crossCheck"];
    if (quote.source === "global" && listing === undefined) {
      crossCheck = undefined;
    } else if (quote.source === "recent_sale" && listing) {
      if (Math.max(listing.price, unitPrice) / Math.min(listing.price, unitPrice) >= CROSS_CHECK_RATIO) {
        crossCheck = { label: "lowest listing", price: listing.price };
      }
    } else if (sale) {
      if (Math.max(sale.price, unitPrice) / Math.min(sale.price, unitPrice) >= CROSS_CHECK_RATIO) {
        crossCheck = { label: `sold avg (${sale.saleCount})`, price: sale.price };
      }
    }

    priced.push({
      itemId: entry.itemId,
      name: entry.name,
      enchantment: entry.enchantment,
      quality: entry.quality,
      amount: entry.amount,
      unitPrice,
      totalValue: itemValue(unitPrice, entry.amount),
      city,
      priceDate: quote.date,
      stale: Number.isFinite(parsedDate) ? now - parsedDate > STALE_AFTER_MS : false,
      players: entry.players,
      source: quote.source,
      saleCount: sale?.saleCount,
      spread:
        listing?.maxPrice && listing.maxPrice / listing.price >= WIDE_SPREAD_RATIO
          ? { min: listing.price, max: listing.maxPrice }
          : undefined,
      globalMarkets: quote.markets,
      crossCheck,
    });
  }

  return { priced, missing };
}

/** Total loot value = sum of all item values (FR-08). */
export function totalValue(items: PricedItem[]): number {
  return items.reduce((sum, item) => sum + item.totalValue, 0);
}

export interface SplitResult {
  share: number;
  remainder: number;
}

/**
 * Equal split (FR-10). Albion trades whole silver only, so each player receives the
 * floor and any indivisible remainder is reported rather than hidden (PRD §14).
 */
export function computeSplit(total: number, participants: number): SplitResult {
  if (!Number.isInteger(participants) || participants < 1) {
    throw new RangeError("Participants must be a whole number of at least 1.");
  }
  const share = Math.floor(total / participants);
  return { share, remainder: total - share * participants };
}

/** Names when provided, otherwise "Player 1..N" (FR-11). */
export function buildParticipantShares(
  participants: number,
  share: number,
  names: string[] = [],
): ParticipantShare[] {
  return Array.from({ length: participants }, (_, index) => ({
    name: names[index]?.trim() || `Player ${index + 1}`,
    share,
  }));
}
