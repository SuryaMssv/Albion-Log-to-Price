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
    // Negative amounts are withdrawals. Zero is a no-op and is rejected so a
    // bad cell cannot silently vanish from the log.
    if (amount === null || amount === 0) {
      errors.push({
        line,
        raw: raw.trim(),
        reason: `Amount must be a non-zero whole number (got "${tokens[columns.amount]}").`,
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
 * Albion chest copies use `MM/DD/YYYY HH:MM:SS`. Returns UTC ms, or null if the
 * cell is not a date — aggregation then falls back to line order.
 */
function parseChestDate(raw: string): number | null {
  const match = raw
    .trim()
    .match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return Date.UTC(year, month - 1, day, Number(match[4] ?? 0), Number(match[5] ?? 0), Number(match[6] ?? 0));
}

/** Oldest event first. Equal timestamps keep file order. */
function compareChestRows(a: ParsedRow, b: ParsedRow): number {
  const timeA = parseChestDate(a.date);
  const timeB = parseChestDate(b.date);
  if (timeA !== null && timeB !== null && timeA !== timeB) return timeA - timeB;
  return a.line - b.line;
}

function stackKey(row: ParsedRow): string {
  return `${row.item.replace(/\s+/g, " ").trim().toLowerCase()}|${row.enchantment}|${row.quality}`;
}

function isTrash(name: string): boolean {
  return name.replace(/\s+/g, " ").trim().toLowerCase() === "trash";
}

/**
 * Merges rows sharing item name + enchantment + quality into one stack (FR-14),
 * keeping the contributing players and source line numbers for auditability.
 *
 * Withdrawals (negative amounts) cancel earlier deposits. A withdrawal that
 * would take the running total below zero is treated as taking out stock from
 * before this log window, so a later re-insert still counts as 1 in the chest.
 *
 * Trash is dropped here: it cannot be sold, traded, or salvaged, so it must
 * never reach the listing, CSV, or market API.
 */
export function aggregateRows(rows: ParsedRow[]): AggregatedEntry[] {
  const groups = new Map<string, ParsedRow[]>();

  for (const row of rows) {
    if (isTrash(row.item)) continue;
    const key = stackKey(row);
    const existing = groups.get(key);
    if (existing) existing.push(row);
    else groups.set(key, [row]);
  }

  const stacks: AggregatedEntry[] = [];
  for (const group of groups.values()) {
    let amount = 0;
    for (const row of [...group].sort(compareChestRows)) {
      amount = Math.max(0, amount + row.amount);
    }
    if (amount <= 0) continue;

    const first = group[0];
    const players: string[] = [];
    for (const row of group) {
      if (row.player && !players.includes(row.player)) players.push(row.player);
    }
    stacks.push({
      name: first.item.replace(/\s+/g, " ").trim(),
      enchantment: first.enchantment,
      quality: first.quality,
      amount,
      players,
      lines: group.map((row) => row.line),
    });
  }

  return stacks;
}
