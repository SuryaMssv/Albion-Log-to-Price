import { aggregateRows, compareChestRows, parseChestDate, type LootRun } from "./parser";
import { itemValue } from "./calculator";
import { itemIdFor } from "./resolver";
import type { AggregatedEntry, CalculationResult, ParsedRow, PricedItem, PriceSource } from "./types";

export interface RunLayout {
  /** Chest-log line number → 0-based run slot. */
  lineRun: Record<number, number>;
  excluded: number[];
  /** Stack keys in officer order per run. Empty means timestamp order. */
  order: string[][];
  /** Stable run-card count from the original cluster, including emptied slots. */
  slots: number;
}

export interface RunStack extends AggregatedEntry {
  key: string;
  excluded: boolean;
}

export interface RunTableItem {
  key: string;
  name: string;
  itemId?: string;
  enchantment: number;
  quality: number;
  amount: number;
  unitPrice: number | null;
  totalValue: number | null;
  lootDate: string;
  excluded: boolean;
  lines: number[];
  players: string[];
  source?: PriceSource;
  city?: PricedItem["city"];
  priceDate?: string;
  stale?: boolean;
  saleCount?: number;
  spread?: PricedItem["spread"];
  globalMarkets?: string[];
  crossCheck?: PricedItem["crossCheck"];
  /** Why this row has no unit price after calculate, if the market/name lookup failed. */
  priceIssue?: string;
}

export function stackKey(entry: { name: string; enchantment: number; quality: number }): string {
  return `${entry.name.replace(/\s+/g, " ").trim().toLowerCase()}|${entry.enchantment}|${entry.quality}`;
}

export function layoutFromRuns(runs: LootRun[]): RunLayout {
  const lineRun: Record<number, number> = {};
  for (const [index, run] of runs.entries()) {
    for (const row of run.rows) lineRun[row.line] = index;
  }
  return { lineRun, excluded: [], order: runs.map(() => []), slots: runs.length };
}

export function runCount(layout: RunLayout): number {
  return layout.slots;
}

export function stacksForRun(rows: ParsedRow[], layout: RunLayout, runIndex: number): RunStack[] {
  const assigned = rows.filter((row) => layout.lineRun[row.line] === runIndex);
  const excluded = new Set(layout.excluded);
  const stacks = aggregateRows(assigned).map((stack) => ({
    ...stack,
    key: stackKey(stack),
    excluded: stack.lines.length > 0 && stack.lines.every((line) => excluded.has(line)),
  }));
  return sortStacks(stacks, layout.order[runIndex] ?? []);
}

export function lineGroupsForCalculate(rows: ParsedRow[], layout: RunLayout): number[][] {
  const count = runCount(layout);
  const excluded = new Set(layout.excluded);
  return Array.from({ length: count }, (_, index) =>
    rows
      .filter((row) => layout.lineRun[row.line] === index && !excluded.has(row.line))
      .sort(compareChestRows)
      .map((row) => row.line),
  );
}

export function runsFromLineGroups(rows: ParsedRow[], groups: number[][]): LootRun[] {
  const byLine = new Map(rows.map((row) => [row.line, row]));
  return groups.map((lines, index) => {
    const group = lines
      .map((line) => byLine.get(line))
      .filter((row): row is ParsedRow => row !== undefined)
      .sort(compareChestRows);
    return {
      index: index + 1,
      startedAt: group[0]?.date ?? "",
      endedAt: group[group.length - 1]?.date ?? "",
      rows: group,
    };
  });
}

export function moveStack(
  layout: RunLayout,
  rows: ParsedRow[],
  fromRun: number,
  toRun: number,
  key: string,
  beforeKey: string | null = null,
): RunLayout {
  const stack = stacksForRun(rows, layout, fromRun).find((entry) => entry.key === key);
  if (!stack || fromRun === toRun) {
    return fromRun === toRun ? reorderStack(layout, rows, fromRun, key, beforeKey) : layout;
  }

  const lineRun = { ...layout.lineRun };
  for (const line of stack.lines) lineRun[line] = toRun;

  const order = ensureOrder(layout, rows);
  for (const list of order) {
    const index = list.indexOf(key);
    if (index !== -1) list.splice(index, 1);
  }
  insertKey(order[toRun], key, beforeKey);
  return { ...layout, lineRun, order };
}

export function reorderStack(
  layout: RunLayout,
  rows: ParsedRow[],
  runIndex: number,
  key: string,
  beforeKey: string | null,
): RunLayout {
  const order = ensureOrder(layout, rows);
  const list = order[runIndex] ?? [];
  const from = list.indexOf(key);
  if (from !== -1) list.splice(from, 1);
  insertKey(list, key, beforeKey);
  order[runIndex] = list;
  return { ...layout, order };
}

export function toggleStackExcluded(
  layout: RunLayout,
  rows: ParsedRow[],
  runIndex: number,
  key: string,
): RunLayout {
  const stack = stacksForRun(rows, layout, runIndex).find((entry) => entry.key === key);
  if (!stack) return layout;
  const excluded = new Set(layout.excluded);
  const allOut = stack.lines.every((line) => excluded.has(line));
  for (const line of stack.lines) {
    if (allOut) excluded.delete(line);
    else excluded.add(line);
  }
  return { ...layout, excluded: [...excluded] };
}

export function tableItemsForRun(
  rows: ParsedRow[],
  layout: RunLayout,
  runIndex: number,
  result: CalculationResult | null,
): RunTableItem[] {
  const catalog = catalogFromResult(result);
  return stacksForRun(rows, layout, runIndex).map((stack) => {
    const priced = catalog.get(stack.key);
    const unitPrice = priced?.unitPrice ?? null;
    return {
      key: stack.key,
      name: stack.name,
      itemId: priced?.itemId ?? itemIdFor(stack.name, stack.enchantment),
      enchantment: stack.enchantment,
      quality: stack.quality,
      amount: stack.amount,
      unitPrice,
      totalValue: unitPrice === null ? null : itemValue(unitPrice, stack.amount),
      lootDate: stack.lootDate ?? "",
      excluded: stack.excluded,
      lines: stack.lines,
      players: stack.players,
      source: priced?.source,
      city: priced?.city,
      priceDate: priced?.priceDate,
      stale: priced?.stale,
      saleCount: priced?.saleCount,
      spread: priced?.spread,
      globalMarkets: priced?.globalMarkets,
      crossCheck: priced?.crossCheck,
      priceIssue: priced ? undefined : priceIssueFor(result, stack),
    };
  });
}

function catalogFromResult(result: CalculationResult | null): Map<string, PricedItem> {
  const catalog = new Map<string, PricedItem>();
  if (!result) return catalog;
  for (const item of [...result.items, ...(result.runs ?? []).flatMap((run) => run.items)]) {
    catalog.set(stackKey(item), item);
  }
  return catalog;
}

function priceIssueFor(result: CalculationResult | null, stack: { key: string }): string | undefined {
  if (!result) return undefined;
  const missing = [
    ...result.missingPrices,
    ...(result.runs ?? []).flatMap((run) => run.missingPrices),
  ];
  const unresolved = [
    ...result.unresolvedItems,
    ...(result.runs ?? []).flatMap((run) => run.unresolvedItems),
  ];
  return (
    missing.find((item) => stackKey(item) === stack.key)?.reason ??
    unresolved.find((item) => stackKey(item) === stack.key)?.reason
  );
}

function ensureOrder(layout: RunLayout, rows: ParsedRow[]): string[][] {
  const count = runCount(layout);
  return Array.from({ length: count }, (_, index) => {
    const existing = layout.order[index] ?? [];
    if (existing.length > 0) return [...existing];
    return stacksForRun(rows, { ...layout, order: layout.order.map(() => []) }, index).map(
      (stack) => stack.key,
    );
  });
}

function insertKey(list: string[], key: string, beforeKey: string | null): void {
  if (beforeKey) {
    const index = list.indexOf(beforeKey);
    if (index === -1) list.push(key);
    else list.splice(index, 0, key);
    return;
  }
  list.push(key);
}

function sortStacks(stacks: RunStack[], order: string[]): RunStack[] {
  if (order.length === 0) {
    return [...stacks].sort((left, right) => compareStacks(left, right));
  }
  const rank = new Map(order.map((key, index) => [key, index]));
  return [...stacks].sort((left, right) => {
    const leftRank = rank.get(left.key);
    const rightRank = rank.get(right.key);
    if (leftRank !== undefined && rightRank !== undefined) return leftRank - rightRank;
    if (leftRank !== undefined) return -1;
    if (rightRank !== undefined) return 1;
    return compareStacks(left, right);
  });
}

function compareStacks(left: RunStack, right: RunStack): number {
  const timeA = parseChestDate(left.lootDate ?? "");
  const timeB = parseChestDate(right.lootDate ?? "");
  if (timeA !== null && timeB !== null && timeA !== timeB) return timeA - timeB;
  return (left.lines[0] ?? 0) - (right.lines[0] ?? 0);
}
