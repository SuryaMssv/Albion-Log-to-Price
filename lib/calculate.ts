import { aggregateRows, parseChestLog } from "./parser";
import { resolveEntries } from "./resolver";
import { fetchPrices, fetchSalesHistory, type Fetcher } from "./market";
import { buildParticipantShares, computeSplit, priceEntries, totalValue } from "./calculator";
import { applyDeductions, type DeductionsInput } from "./deductions";
import type { CalculationResult, City, PriceBasis, ServerId } from "./types";
import { isCity, PRICE_BASES, SERVERS } from "./types";

/** Guardrails for the public endpoint (PRD §18). */
export const MAX_LOG_CHARS = 1_000_000;
export const MAX_ROWS = 5_000;
export const MAX_PARTICIPANTS = 100;
export const MAX_REPAIR_COST = 1_000_000_000_000;
export const MAX_TAX_PERCENT = 100;

export class ValidationError extends Error {}

export interface CalculateInput {
  log: string;
  server: ServerId;
  city: City;
  priceBasis: PriceBasis;
  participants: number;
  participantNames?: string[];
  repairCost?: number;
  sellerTaxPercent?: number;
  marketTaxPercent?: number;
}

/** Validates and normalizes an untrusted request body. */
export function validateInput(body: unknown): CalculateInput {
  if (typeof body !== "object" || body === null) {
    throw new ValidationError("Request body must be a JSON object.");
  }
  const raw = body as Record<string, unknown>;

  const log = typeof raw.log === "string" ? raw.log : "";
  if (log.trim() === "") throw new ValidationError("No chest log was provided.");
  if (log.length > MAX_LOG_CHARS) {
    throw new ValidationError(
      `Chest log is too large (${log.length.toLocaleString()} characters, limit ${MAX_LOG_CHARS.toLocaleString()}).`,
    );
  }

  const server = typeof raw.server === "string" ? raw.server : "east";
  if (!(server in SERVERS)) throw new ValidationError(`Unknown server "${server}".`);

  // The market to price against is a required, explicit choice — there is no sensible
  // default, and guessing one would silently change every number on the page.
  const city = typeof raw.city === "string" ? raw.city.trim() : "";
  if (city === "") throw new ValidationError("Select a city to price the loot against.");
  if (!isCity(city)) throw new ValidationError(`Unknown city "${city}".`);

  const priceBasis = typeof raw.price_basis === "string" ? raw.price_basis : "sell_mid";
  if (!(priceBasis in PRICE_BASES)) throw new ValidationError(`Unknown price basis "${priceBasis}".`);

  const participants = Number(raw.participants);
  if (!Number.isInteger(participants) || participants < 1 || participants > MAX_PARTICIPANTS) {
    throw new ValidationError(`Participants must be a whole number from 1 to ${MAX_PARTICIPANTS}.`);
  }

  const namesInput = Array.isArray(raw.participant_names) ? raw.participant_names : [];
  const participantNames = namesInput
    .slice(0, participants)
    .map((name) => (typeof name === "string" ? name.slice(0, 40).trim() : ""));

  const repairCost = parseWholeSilver(raw.repair_cost, "Repair cost", MAX_REPAIR_COST);
  const sellerTaxPercent = parsePercent(raw.seller_tax, "Seller's tax");
  const marketTaxPercent = parsePercent(raw.market_tax, "Market tax");

  return {
    log,
    server: server as ServerId,
    city,
    priceBasis: priceBasis as PriceBasis,
    participants,
    participantNames,
    repairCost,
    sellerTaxPercent,
    marketTaxPercent,
  };
}

function parseWholeSilver(raw: unknown, label: string, max: number): number {
  if (raw === undefined || raw === null || raw === "") return 0;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new ValidationError(`${label} must be a whole number of silver from 0 to ${max.toLocaleString()}.`);
  }
  return value;
}

function parsePercent(raw: unknown, label: string): number {
  if (raw === undefined || raw === null || raw === "") return 0;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > MAX_TAX_PERCENT) {
    throw new ValidationError(`${label} must be a percentage from 0 to ${MAX_TAX_PERCENT}.`);
  }
  return value;
}

/**
 * Runs the full pipeline: parse -> aggregate -> resolve -> price -> total -> split
 * (PRD §11). Nothing is persisted; the log lives only for the duration of the call.
 */
export async function calculateLootSplit(
  input: CalculateInput,
  fetcher: Fetcher = fetch,
): Promise<CalculationResult> {
  const parsed = parseChestLog(input.log);

  if (parsed.rows.length === 0) {
    throw new ValidationError(
      "Could not parse the chest log. Please make sure the copied log includes the Date, Player, Item, Enchantment, Quality, and Amount columns.",
    );
  }
  if (parsed.rows.length > MAX_ROWS) {
    throw new ValidationError(
      `Chest log has ${parsed.rows.length.toLocaleString()} rows, above the ${MAX_ROWS.toLocaleString()} row limit.`,
    );
  }

  const stacks = aggregateRows(parsed.rows);
  const { resolved, unresolved } = resolveEntries(stacks);

  const marketStart = Date.now();
  const lookup = await fetchPrices(
    resolved.map((entry) => ({ itemId: entry.itemId, quality: entry.quality })),
    input.server,
    input.city,
    fetcher,
  );

  // Sales history is fetched for every stack, not just unpriced ones: it is both the
  // fallback source and the figure each listing price is corroborated against.
  const history = await fetchSalesHistory(
    resolved.map((entry) => ({ itemId: entry.itemId, quality: entry.quality })),
    input.server,
    input.city,
    fetcher,
  );
  const marketMs = Date.now() - marketStart;

  const { priced, missing } = priceEntries(resolved, lookup, input.city, {
    history,
    basis: input.priceBasis,
  });
  priced.sort((a, b) => b.totalValue - a.totalValue);

  const total = totalValue(priced);
  const { share, remainder } = computeSplit(total, input.participants);
  const deductions: DeductionsInput = {
    repairCost: input.repairCost ?? 0,
    sellerTaxPercent: input.sellerTaxPercent ?? 0,
    marketTaxPercent: input.marketTaxPercent ?? 0,
  };

  return applyDeductions(
    {
      totalValue: total,
      netValue: total,
      repairCost: 0,
      sellerTaxPercent: 0,
      marketTaxPercent: 0,
      sellerFee: 0,
      marketFee: 0,
      participants: input.participants,
      share,
      remainder,
      participantShares: buildParticipantShares(input.participants, share, input.participantNames),
      items: priced,
      unresolvedItems: unresolved,
      missingPrices: missing,
      parseErrors: parsed.errors,
      priceBasis: input.priceBasis,
      server: input.server,
      city: input.city,
      stats: {
        rowsParsed: parsed.rows.length,
        rowsFailed: parsed.errors.length,
        stacks: stacks.length,
        itemsPriced: priced.length,
        calculatedAt: new Date().toISOString(),
        marketMs,
      },
      warnings: [...lookup.warnings, ...history.warnings],
    },
    deductions,
  );
}
