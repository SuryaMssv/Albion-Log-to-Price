import type { AggregatedEntry, ParseResult, ParsedRow, ParseError } from "./types";

/**
 * Parses an Albion guild chest log (FR-03).
 *
 * The in-game "copy" produces double-quoted, space-separated columns:
 *
 *   "08/18/2026 11:49:51" "DemiG0Dz" "Adept's Fiend Cowl" "2" "4" "1"
 *
 * Tab- and comma-separated exports of the same columns are accepted too, as is an
 * optional header row — when present, its labels drive column order instead of
 * position, so re-ordered exports still parse.
 */

type Column = "date" | "player" | "item" | "enchantment" | "quality" | "amount";

/** Header labels seen in the wild, mapped onto our canonical columns. */
const HEADER_ALIASES: Record<string, Column> = {
  date: "date",
  time: "date",
  timestamp: "date",
  datetime: "date",
  player: "player",
  playername: "player",
  name: "player",
  character: "player",
  item: "item",
  itemname: "item",
  enchantment: "enchantment",
  enchant: "enchantment",
  enchantmentlevel: "enchantment",
  quality: "quality",
  qualitylevel: "quality",
  amount: "amount",
  quantity: "amount",
  qty: "amount",
  count: "amount",
};

const MAX_ENCHANTMENT = 4;
const MAX_QUALITY = 5;

/**
 * Splits one log line into fields. Quoted fields win because item names contain
 * spaces; otherwise fall back to tabs, then commas, then runs of whitespace.
 */
export function tokenizeLine(line: string): string[] {
  const quoted = line.match(/"([^"]*)"/g);
  if (quoted && quoted.length >= 2) {
    return quoted.map((token) => token.slice(1, -1).trim());
  }
  if (line.includes("\t")) {
    return line.split("\t").map((token) => unquote(token));
  }
  if (line.includes(",")) {
    return splitCsv(line).map((token) => unquote(token));
  }
  return line.split(/\s{2,}/).map((token) => unquote(token));
}

function unquote(token: string): string {
  const trimmed = token.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/** Comma split that respects double quotes, so `"Adept's Bag, Large"` stays whole. */
function splitCsv(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
    } else if (char === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

function normalizeHeaderToken(token: string): string {
  return token.replace(/[^a-z]/gi, "").toLowerCase();
}

/** Returns a column->index map if the tokens look like a header row, else null. */
function readHeader(tokens: string[]): Partial<Record<Column, number>> | null {
  const mapping: Partial<Record<Column, number>> = {};
  let matched = 0;
  tokens.forEach((token, index) => {
    const column = HEADER_ALIASES[normalizeHeaderToken(token)];
    if (column && mapping[column] === undefined) {
      mapping[column] = index;
      matched++;
    }
  });
  // Require the columns that make a row meaningful before trusting the header.
  const hasCore =
    mapping.item !== undefined && mapping.amount !== undefined && matched >= 4;
  return hasCore ? mapping : null;
}

/** Accepts "1", " 1 ", "1,000" and "1.0" -> 1. */
function parseInteger(raw: string): number | null {
  const cleaned = raw.replace(/[\s,_]/g, "");
  if (!/^-?\d+(\.0+)?$/.test(cleaned)) return null;
  return Math.trunc(Number(cleaned));
}

export function parseChestLog(text: string): ParseResult {
  const rows: ParsedRow[] = [];
  const errors: ParseError[] = [];
  let consideredLines = 0;
  let mapping: Partial<Record<Column, number>> | null = null;

  const lines = text.split(/\r?\n/);

  lines.forEach((raw, index) => {
    const line = index + 1;
    if (raw.trim() === "") return; // FR-01: blank lines are ignored.

    const tokens = tokenizeLine(raw).filter((token, i, all) => {
      // Drop a trailing empty field produced by a line-ending separator.
      return !(token === "" && i === all.length - 1);
    });

    if (mapping === null) {
      const header = readHeader(tokens);
      if (header) {
        mapping = header;
        return; // The header itself is not data.
      }
    }

    consideredLines++;

    const columns: Record<Column, number> = {
      date: mapping?.date ?? 0,
      player: mapping?.player ?? 1,
      item: mapping?.item ?? 2,
      enchantment: mapping?.enchantment ?? 3,
      quality: mapping?.quality ?? 4,
      amount: mapping?.amount ?? 5,
    };

    const required = Math.max(...Object.values(columns)) + 1;
    if (tokens.length < required) {
      errors.push({
        line,
        raw: raw.trim(),
        reason: `Expected ${required} columns (Date, Player, Item, Enchantment, Quality, Amount) but found ${tokens.length}.`,
      });
      return;
    }

    const item = tokens[columns.item]?.trim() ?? "";
    if (item === "") {
      errors.push({ line, raw: raw.trim(), reason: "Item name is empty." });
      return;
    }

    const enchantment = parseInteger(tokens[columns.enchantment] ?? "");
    if (enchantment === null || enchantment < 0 || enchantment > MAX_ENCHANTMENT) {
      errors.push({
        line,
        raw: raw.trim(),
        reason: `Enchantment must be a whole number from 0 to ${MAX_ENCHANTMENT} (got "${tokens[columns.enchantment]}").`,
      });
      return;
    }

    const quality = parseInteger(tokens[columns.quality] ?? "");
    if (quality === null || quality < 1 || quality > MAX_QUALITY) {
      errors.push({
        line,
        raw: raw.trim(),
        reason: `Quality must be a whole number from 1 to ${MAX_QUALITY} (got "${tokens[columns.quality]}").`,
      });
      return;
    }

    const amount = parseInteger(tokens[columns.amount] ?? "");
    if (amount === null || amount <= 0) {
      errors.push({
        line,
        raw: raw.trim(),
        reason: `Amount must be a whole number greater than 0 (got "${tokens[columns.amount]}").`,
      });
      return;
    }

    rows.push({
      line,
      date: tokens[columns.date]?.trim() ?? "",
      player: tokens[columns.player]?.trim() ?? "",
      item,
      enchantment,
      quality,
      amount,
    });
  });

  return { rows, errors, consideredLines };
}

/**
 * Merges rows sharing item name + enchantment + quality into one stack (FR-14),
 * keeping the contributing players and source line numbers for auditability.
 */
export function aggregateRows(rows: ParsedRow[]): AggregatedEntry[] {
  const stacks = new Map<string, AggregatedEntry>();

  for (const row of rows) {
    const key = `${row.item.replace(/\s+/g, " ").trim().toLowerCase()}|${row.enchantment}|${row.quality}`;
    const existing = stacks.get(key);
    if (existing) {
      existing.amount += row.amount;
      existing.lines.push(row.line);
      if (row.player && !existing.players.includes(row.player)) {
        existing.players.push(row.player);
      }
    } else {
      stacks.set(key, {
        name: row.item.replace(/\s+/g, " ").trim(),
        enchantment: row.enchantment,
        quality: row.quality,
        amount: row.amount,
        players: row.player ? [row.player] : [],
        lines: [row.line],
      });
    }
  }

  return [...stacks.values()];
}
