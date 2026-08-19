import rawIndex from "@/data/item-index.json";
import type { AggregatedEntry, ResolvedEntry, UnresolvedEntry } from "./types";

/**
 * Resolves Albion display names to market API item ids (FR-04).
 *
 * `data/item-index.json` is generated from the official binary dumps by
 * `scripts/build-item-index.mjs`, so this is a metadata lookup rather than a
 * hand-maintained mapping (PRD §12). Each entry is `[baseId, maxEnchantment]`;
 * enchantment is appended here because the dump gives every enchantment level of
 * an item the same display name.
 */

interface ItemIndex {
  source: string;
  generatedAt: string;
  names: number;
  items: Record<string, [string, number][]>;
}

const index = rawIndex as unknown as ItemIndex;

export const itemIndexMeta = {
  source: index.source,
  generatedAt: index.generatedAt,
  names: index.names,
};

/** Must match `normalizeName` in scripts/build-item-index.mjs. */
export function normalizeName(name: string): string {
  return name
    .replace(/[‘’ʼ´`]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function buildItemId(baseId: string, enchantment: number): string {
  return enchantment > 0 ? `${baseId}@${enchantment}` : baseId;
}

/** Lookup with a couple of forgiving fallbacks for hand-edited logs. */
function lookup(name: string): [string, number][] | undefined {
  const normalized = normalizeName(name);
  const direct = index.items[normalized];
  if (direct) return direct;

  // Trailing parenthetical, e.g. "Adept's Bag (Locked)".
  const withoutParens = normalized.replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (withoutParens !== normalized && index.items[withoutParens]) {
    return index.items[withoutParens];
  }

  // Some exports drop the possessive apostrophe: "Adepts Bag".
  const deapostrophized = normalized.replace(/'/g, "");
  for (const key of Object.keys(index.items)) {
    if (key.replace(/'/g, "") === deapostrophized) return index.items[key];
  }

  return undefined;
}

/** Cheap "did you mean" for unresolved names: token overlap, then length affinity. */
export function suggestNames(name: string, limit = 3): string[] {
  const normalized = normalizeName(name);
  const words = normalized.split(" ").filter((word) => word.length > 2);
  if (words.length === 0) return [];

  const scored: { key: string; score: number }[] = [];
  for (const key of Object.keys(index.items)) {
    let hits = 0;
    for (const word of words) if (key.includes(word)) hits++;
    if (hits === 0) continue;
    scored.push({ key, score: hits - Math.abs(key.length - normalized.length) / 100 });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.key);
}

export interface ResolutionResult {
  resolved: ResolvedEntry[];
  unresolved: UnresolvedEntry[];
}

export function resolveEntries(entries: AggregatedEntry[]): ResolutionResult {
  const resolved: ResolvedEntry[] = [];
  const unresolved: UnresolvedEntry[] = [];

  for (const entry of entries) {
    const candidates = lookup(entry.name);

    if (!candidates || candidates.length === 0) {
      const suggestions = suggestNames(entry.name);
      unresolved.push({
        ...entry,
        reason: suggestions.length
          ? `No Albion item matches this name. Closest matches: ${suggestions.join(", ")}.`
          : "No Albion item matches this name.",
      });
      continue;
    }

    const [baseId, maxEnchantment] = candidates[0];

    if (entry.enchantment > maxEnchantment) {
      unresolved.push({
        ...entry,
        reason: `${baseId} has no enchantment ${entry.enchantment} (dump lists up to ${maxEnchantment}).`,
      });
      continue;
    }

    resolved.push({
      ...entry,
      baseId,
      itemId: buildItemId(baseId, entry.enchantment),
      alternatives: candidates.length > 1 ? candidates.slice(1).map(([id]) => id) : undefined,
    });
  }

  return { resolved, unresolved };
}
