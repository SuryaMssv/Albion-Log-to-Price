import { aggregateRows, clusterRowsIntoRuns, parseChestLog } from "./parser";
import { runsFromLineGroups } from "./runs";
import { resolveEntries } from "./resolver";
import { fetchPrices, fetchSalesHistory, type Fetcher } from "./market";
import { buildParticipantShares, computeSplit, priceEntries, totalValue } from "./calculator";
import { rollupRuns, type DeductionsInput } from "./deductions";
import type { CalculationResult, City, LootRunResult, PriceBasis, ServerId } from "./types";
import { isCity, PRICE_BASES, SERVERS } from "./types";

/** Guardrails for the public endpoint (PRD §18). */
export const MAX_LOG_CHARS = 1_000_000;
export const MAX_ROWS = 5_000;
export const MAX_PARTICIPANTS = 100;
export const MAX_REPAIR_COST = 1_000_000_000_000;
export const MAX_TAX_PERCENT = 100;

export class ValidationError extends Error {}

export interface RunParticipants {
  participants: number;
  participantNames: string[];
}

export interface CalculateInput {
  log: string;
  server: ServerId;
  city: City;
  priceBasis: PriceBasis;
  participants: number;
  participantNames?: string[];
  runs?: RunParticipants[];
  /** Line numbers per run slot. When set, these groups replace timestamp clustering. */
  runLines?: number[][];
  repairCost?: number;
  sellerTaxPercent?: number;
  guildTaxPercent?: number;
  premium?: boolean;
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
  const sellerTaxPercent = parsePercent(raw.seller_tax, "Seller buffer tax");
  const guildTaxPercent = parsePercent(raw.guild_tax, "Guild tax");
  const premium = parsePremium(raw.premium);
  const runs = parseRuns(raw.runs);
  const runLines = parseRunLines(raw.run_lines);

  return {
    log,
    server: server as ServerId,
    city,
    priceBasis: priceBasis as PriceBasis,
    participants,
    participantNames,
    runs,
    runLines,
    repairCost,
    sellerTaxPercent,
    guildTaxPercent,
    premium,
  };
}

function parseRunLines(raw: unknown): number[][] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  return raw.map((entry, index) => {
    if (!Array.isArray(entry)) {
      throw new ValidationError(`Run ${index + 1} line list is invalid.`);
    }
    return entry.map((line) => {
      const value = Number(line);
      if (!Number.isInteger(value) || value < 1) {
        throw new ValidationError(`Run ${index + 1} contains an invalid log line.`);
      }
      return value;
    });
  });
}

function parseRuns(raw: unknown): RunParticipants[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  return raw.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new ValidationError(`Run ${index + 1} is invalid.`);
    }
    const row = entry as Record<string, unknown>;
    const participants = Number(row.participants);
    if (!Number.isInteger(participants) || participants < 1 || participants > MAX_PARTICIPANTS) {
      throw new ValidationError(`Run ${index + 1} participants must be a whole number from 1 to ${MAX_PARTICIPANTS}.`);
    }
    const namesInput = Array.isArray(row.participant_names) ? row.participant_names : [];
    const participantNames = namesInput
      .slice(0, participants)
      .map((name) => (typeof name === "string" ? name.slice(0, 40).trim() : ""));
    return { participants, participantNames };
  });
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

function parsePremium(raw: unknown): boolean {
  if (raw === undefined || raw === null || raw === "") return true;
  if (typeof raw !== "boolean") {
    throw new ValidationError("Premium must be true or false.");
  }
  return raw;
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

  const lootRuns = input.runLines
    ? runsFromLineGroups(parsed.rows, input.runLines)
    : clusterRowsIntoRuns(parsed.rows);
  if (lootRuns.length === 0 || lootRuns.every((run) => run.rows.length === 0)) {
    throw new ValidationError(
      "Could not parse the chest log. Please make sure the copied log includes the Date, Player, Item, Enchantment, Quality, and Amount columns.",
    );
  }

  const prepared = lootRuns.map((run) => {
    const stacks = aggregateRows(run.rows);
    const { resolved, unresolved } = resolveEntries(stacks);
    return { run, stacks, resolved, unresolved };
  });
  const allResolved = prepared.flatMap((entry) => entry.resolved);

  const marketStart = Date.now();
  const lookup = await fetchPrices(
    allResolved.map((entry) => ({ itemId: entry.itemId, quality: entry.quality })),
    input.server,
    input.city,
    fetcher,
  );

  // Sales history is fetched for every stack, not just unpriced ones: it is both the
  // fallback source and the figure each listing price is corroborated against.
  const history = await fetchSalesHistory(
    allResolved.map((entry) => ({ itemId: entry.itemId, quality: entry.quality })),
    input.server,
    input.city,
    fetcher,
  );
  const marketMs = Date.now() - marketStart;

  const deductions: DeductionsInput = {
    repairCost: input.repairCost ?? 0,
    sellerTaxPercent: input.sellerTaxPercent ?? 0,
    guildTaxPercent: input.guildTaxPercent ?? 0,
    premium: input.premium ?? true,
  };

  const runs: LootRunResult[] = prepared.flatMap((entry, index) => {
    if (entry.run.rows.length === 0) return [];
    const { priced, missing } = priceEntries(entry.resolved, lookup, input.city, {
      history,
      basis: input.priceBasis,
    });
    priced.sort((a, b) => b.totalValue - a.totalValue);
    const config = input.runs?.[index] ?? {
      participants: input.participants,
      participantNames: input.participantNames ?? [],
    };
    const total = totalValue(priced);
    const { share, remainder } = computeSplit(total, config.participants);
    return [
      {
        index: entry.run.index,
        startedAt: entry.run.startedAt,
        endedAt: entry.run.endedAt,
        totalValue: total,
        netValue: total,
        repairCost: 0,
        sellerTaxPercent: 0,
        guildTaxPercent: 0,
        premium: deductions.premium,
        marketSetupPercent: 0,
        marketTaxPercent: 0,
        sellerFee: 0,
        guildFee: 0,
        marketSetupFee: 0,
        marketTaxFee: 0,
        marketFee: 0,
        participants: config.participants,
        share,
        remainder,
        participantShares: buildParticipantShares(config.participants, share, config.participantNames),
        items: priced,
        unresolvedItems: entry.unresolved,
        missingPrices: missing,
      },
    ];
  });

  return rollupRuns(
    {
      parseErrors: parsed.errors,
      priceBasis: input.priceBasis,
      server: input.server,
      city: input.city,
      stats: {
        rowsParsed: parsed.rows.length,
        rowsFailed: parsed.errors.length,
        stacks: prepared.reduce((sum, entry) => sum + entry.stacks.length, 0),
        itemsPriced: runs.reduce((sum, run) => sum + run.items.length, 0),
        calculatedAt: new Date().toISOString(),
        marketMs,
      },
      warnings: [...lookup.warnings, ...history.warnings],
    },
    runs,
    deductions,
  );
}
