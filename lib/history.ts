import type { CalculationResult, City, ParticipantShare, PriceBasis, ServerId } from "./types";

export const HISTORY_KEY = "ao-loot-split-history-v1";
export const MAX_HISTORY = 50;

export interface HistorySnapshot {
  totalValue: number;
  netValue: number;
  share: number;
  remainder: number;
  participantShares: ParticipantShare[];
}

export interface ChestLogHistoryInputs {
  log: string;
  server: ServerId;
  city: City;
  priceBasis: PriceBasis;
  participants: string;
  useNames: boolean;
  names: string[];
  repairCost: string;
  sellerTax: string;
  guildTax: string;
  premium: boolean;
}

export interface CalculatorHistoryInputs {
  gross: string;
  repairCost: string;
  sellerTax: string;
  guildTax: string;
  premium: boolean;
  participants: string;
  useNames: boolean;
  names: string[];
}

export type ChestLogHistoryEntry = {
  id: string;
  savedAt: string;
  source: "chest-log";
  inputs: ChestLogHistoryInputs;
  overrides: Record<string, number>;
  result: CalculationResult;
  snapshot: HistorySnapshot;
};

export type CalculatorHistoryEntry = {
  id: string;
  savedAt: string;
  source: "calculator";
  inputs: CalculatorHistoryInputs;
  snapshot: HistorySnapshot;
};

export type HistoryEntry = ChestLogHistoryEntry | CalculatorHistoryEntry;

export function newHistoryId(): string {
  return crypto.randomUUID();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSnapshot(value: unknown): value is HistorySnapshot {
  if (!isRecord(value)) return false;
  return (
    typeof value.totalValue === "number" &&
    typeof value.netValue === "number" &&
    typeof value.share === "number" &&
    typeof value.remainder === "number" &&
    Array.isArray(value.participantShares)
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isCalculatorEntry(value: unknown): value is CalculatorHistoryEntry {
  if (!isRecord(value) || value.source !== "calculator") return false;
  if (typeof value.id !== "string" || typeof value.savedAt !== "string") return false;
  if (!isSnapshot(value.snapshot) || !isRecord(value.inputs)) return false;
  const inputs = value.inputs;
  return (
    typeof inputs.gross === "string" &&
    typeof inputs.repairCost === "string" &&
    typeof inputs.sellerTax === "string" &&
    typeof inputs.guildTax === "string" &&
    typeof inputs.premium === "boolean" &&
    typeof inputs.participants === "string" &&
    typeof inputs.useNames === "boolean" &&
    isStringArray(inputs.names)
  );
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  if (!isRecord(value)) return false;
  return Object.values(value).every((item) => typeof item === "number" && Number.isFinite(item));
}

function isChestLogEntry(value: unknown): value is ChestLogHistoryEntry {
  if (!isRecord(value) || value.source !== "chest-log") return false;
  if (typeof value.id !== "string" || typeof value.savedAt !== "string") return false;
  if (!isSnapshot(value.snapshot) || !isRecord(value.inputs) || !isRecord(value.result)) return false;
  if (!isNumberRecord(value.overrides)) return false;
  const inputs = value.inputs;
  return (
    typeof inputs.log === "string" &&
    typeof inputs.server === "string" &&
    typeof inputs.city === "string" &&
    typeof inputs.priceBasis === "string" &&
    typeof inputs.participants === "string" &&
    typeof inputs.useNames === "boolean" &&
    isStringArray(inputs.names) &&
    typeof inputs.repairCost === "string" &&
    typeof inputs.sellerTax === "string" &&
    typeof inputs.guildTax === "string" &&
    typeof inputs.premium === "boolean"
  );
}

export function isHistoryEntry(value: unknown): value is HistoryEntry {
  return isCalculatorEntry(value) || isChestLogEntry(value);
}

export function snapshotFromResult(result: {
  totalValue: number;
  netValue: number;
  share: number;
  remainder: number;
  participantShares: ParticipantShare[];
}): HistorySnapshot {
  return {
    totalValue: result.totalValue,
    netValue: result.netValue,
    share: result.share,
    remainder: result.remainder,
    participantShares: result.participantShares,
  };
}

export function parseHistory(raw: string | null): HistoryEntry[] {
  if (raw === null || raw.trim() === "") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isHistoryEntry);
  } catch {
    return [];
  }
}

export function upsertEntry(entries: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  const rest = entries.filter((item) => item.id !== entry.id);
  return [entry, ...rest].slice(0, MAX_HISTORY);
}

export function removeEntry(entries: HistoryEntry[], id: string): HistoryEntry[] {
  return entries.filter((entry) => entry.id !== id);
}

const EMPTY_HISTORY: HistoryEntry[] = [];
const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedEntries: HistoryEntry[] = EMPTY_HISTORY;

function notifyHistory(): void {
  for (const listener of listeners) listener();
}

export function subscribeHistory(listener: () => void): () => void {
  listeners.add(listener);
  if (typeof window !== "undefined") {
    window.addEventListener("storage", listener);
  }
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", listener);
    }
  };
}

export function getHistorySnapshot(): HistoryEntry[] {
  if (typeof localStorage === "undefined") return cachedEntries;
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (raw === cachedRaw) return cachedEntries;
    cachedRaw = raw;
    cachedEntries = parseHistory(raw);
    return cachedEntries;
  } catch {
    return cachedEntries;
  }
}

export function getServerHistorySnapshot(): HistoryEntry[] {
  return EMPTY_HISTORY;
}

export function readHistory(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): HistoryEntry[] {
  if (!storage) return [];
  try {
    return parseHistory(storage.getItem(HISTORY_KEY));
  } catch {
    return [];
  }
}

export function writeHistory(
  entries: HistoryEntry[],
  storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage,
): HistoryEntry[] {
  const capped = entries.slice(0, MAX_HISTORY);
  if (!storage) return capped;
  try {
    const serialized = JSON.stringify(capped);
    storage.setItem(HISTORY_KEY, serialized);
    cachedRaw = serialized;
    cachedEntries = capped;
    notifyHistory();
    return capped;
  } catch {
    if (capped.length <= 1) {
      cachedRaw = "[]";
      cachedEntries = EMPTY_HISTORY;
      notifyHistory();
      return [];
    }
    return writeHistory(capped.slice(0, -1), storage);
  }
}
