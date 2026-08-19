/** Shared domain types for the loot calculator pipeline (PRD §11). */

/** Albion Online Data Project regional servers. */
export type ServerId = "east" | "west" | "europe";

/**
 * How a market price is derived (FR-06). Sell side only — a buy order is what someone
 * offers to pay, and lowball standing offers would badly understate a chest.
 *
 * The lowest sell order is the fast-sale price, but it is a single listing: one stale or
 * mispriced entry drags a whole stack down. Splitting the listing range is less sensitive
 * to that, so it is the default.
 */
export type PriceBasis = "sell_min" | "sell_mid";

/** Where a unit price came from. Shown on every row so a total can be audited. */
export type PriceSource = "sell_order" | "sell_mid" | "global" | "recent_sale" | "manual";

export const PRICE_SOURCES: Record<PriceSource, { label: string; short: string }> = {
  sell_order: { label: "Lowest sell order", short: "Sell order" },
  sell_mid: { label: "Mid of listing range", short: "Mid range" },
  global: { label: "Sell orders in other markets", short: "Global" },
  recent_sale: { label: "Recent sales average", short: "Recent sales" },
  manual: { label: "Manual price", short: "Manual" },
};

/**
 * Markets a price can be read from. The Black Market is deliberately absent — it only
 * buys, at NPC buy-order prices, so it cannot answer "what is this selling for".
 */
export const CITIES = [
  "Caerleon",
  "Bridgewatch",
  "Fort Sterling",
  "Lymhurst",
  "Martlock",
  "Thetford",
  "Brecilien",
] as const;

export type City = (typeof CITIES)[number];

export function isCity(value: string): value is City {
  return (CITIES as readonly string[]).includes(value);
}

export const SERVERS: Record<ServerId, { label: string; short: string; api: string }> = {
  east: { label: "Asia / East", short: "East", api: "https://east.albion-online-data.com" },
  west: { label: "Americas / West", short: "West", api: "https://west.albion-online-data.com" },
  europe: { label: "Europe", short: "Europe", api: "https://europe.albion-online-data.com" },
};

export const PRICE_BASES: Record<PriceBasis, { label: string; short: string; hint: string }> = {
  sell_min: {
    label: "Lowest sell order",
    short: "lowest sell order",
    hint: "Undercut-to-sell-now price. One cheap listing can drag a stack down.",
  },
  sell_mid: {
    label: "Mid of listing range",
    short: "mid listing range",
    hint: "Midpoint of the cheapest and dearest listing. Ignores a lone outlier.",
  },
};

/** One successfully parsed chest-log row. */
export interface ParsedRow {
  /** 1-based line number in the submitted log, for error reporting. */
  line: number;
  date: string;
  player: string;
  item: string;
  enchantment: number;
  quality: number;
  amount: number;
}

/** A row that could not be parsed. Never silently dropped (FR-03). */
export interface ParseError {
  line: number;
  raw: string;
  reason: string;
}

export interface ParseResult {
  rows: ParsedRow[];
  errors: ParseError[];
  /** Non-blank, non-header lines seen. */
  consideredLines: number;
}

/** Identical item + enchantment + quality rows merged into one stack (FR-14). */
export interface AggregatedEntry {
  name: string;
  enchantment: number;
  quality: number;
  amount: number;
  players: string[];
  lines: number[];
}

export interface ResolvedEntry extends AggregatedEntry {
  /** Market API identifier, e.g. `T4_HEAD_CLOTH_HELL@2`. */
  itemId: string;
  baseId: string;
  /** Other base ids sharing this display name, if the name was ambiguous. */
  alternatives?: string[];
}

export interface UnresolvedEntry extends AggregatedEntry {
  reason: string;
}

/** A resolved stack with a usable market price. */
export interface PricedItem {
  itemId: string;
  name: string;
  enchantment: number;
  quality: number;
  amount: number;
  unitPrice: number;
  totalValue: number;
  /** The selected market this order sits in. */
  city: City;
  /** ISO timestamp reported by the market API for that order. */
  priceDate: string;
  /** Price observation older than the freshness window. */
  stale: boolean;
  players: string[];
  /** Which dataset the unit price came from. */
  source: PriceSource;
  /** Units sold in the observed window, when sales data exists. */
  saleCount?: number;
  /** Cheapest and dearest current listing, when the market reported both. */
  spread?: { min: number; max: number };
  /** Markets that contributed, when the price came from outside the selected city. */
  globalMarkets?: string[];
  /**
   * What the chosen price is being checked against — the sales average when priced off
   * listings, or the lowest listing when priced off sales. Populated only when the two
   * disagree enough to be worth showing.
   */
  crossCheck?: { label: string; price: number };
}

/** Resolved, but the market has no usable order (FR-16). */
export interface MissingPriceItem {
  itemId: string;
  name: string;
  enchantment: number;
  quality: number;
  amount: number;
  reason: string;
  players: string[];
}

export interface ParticipantShare {
  name: string;
  share: number;
}

export interface CalculationResult {
  /** Gross market value of priced stacks. Item rows always sum to this. */
  totalValue: number;
  /** Gross minus repair and selling fees — this is what is split. */
  netValue: number;
  repairCost: number;
  sellerTaxPercent: number;
  marketTaxPercent: number;
  /** Whole silver taken as seller's tax (percent of gross). */
  sellerFee: number;
  /** Whole silver taken as market tax (percent of gross). */
  marketFee: number;
  participants: number;
  share: number;
  /** Silver left over when the total does not divide evenly (PRD §14). */
  remainder: number;
  participantShares: ParticipantShare[];
  items: PricedItem[];
  unresolvedItems: UnresolvedEntry[];
  missingPrices: MissingPriceItem[];
  parseErrors: ParseError[];
  priceBasis: PriceBasis;
  server: ServerId;
  city: City;
  stats: {
    rowsParsed: number;
    rowsFailed: number;
    stacks: number;
    itemsPriced: number;
    calculatedAt: string;
    /** Wall-clock time spent talking to the market API, in ms. */
    marketMs: number;
  };
  /** Non-fatal problems, e.g. a partially failed market lookup. */
  warnings: string[];
}
