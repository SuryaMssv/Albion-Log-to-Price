#!/usr/bin/env node
/**
 * Builds data/item-index.json from the Albion Online binary dumps.
 *
 * Source: ao-data/ao-bin-dumps `formatted/items.txt`, one line per item:
 *
 *   4910: T4_HEAD_CLOTH_HELL@2   : Adept's Fiend Cowl
 *
 * The displayed name is identical across enchantment levels, so the index maps a
 * normalized display name to its *base* item id plus the highest enchantment level
 * the dump knows about. Enchantment is re-attached at resolve time (FR-04).
 *
 * Usage:
 *   node scripts/build-item-index.mjs            # download the latest dump
 *   node scripts/build-item-index.mjs ./items.txt  # build from a local dump
 */
import { writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_URL =
  "https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master/formatted/items.txt";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "item-index.json");

/** Same normalization the resolver applies to chest-log item names. */
function normalizeName(name) {
  return name
    .replace(/[‘’ʼ´`]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Ranks candidates when several base ids share a display name (63 of ~5,100 names,
 * all vendor trash / furniture / arena bags). Tradable, non-unique ids win.
 */
function candidateRank(id) {
  let rank = 0;
  if (id.includes("NONTRADABLE")) rank += 100;
  if (id.startsWith("UNIQUE_")) rank += 10;
  if (id.includes("_SKIN_")) rank += 10;
  return rank;
}

async function loadDump(localPath) {
  if (localPath) return readFileSync(localPath, "utf8");
  const res = await fetch(SOURCE_URL);
  if (!res.ok) {
    throw new Error(`Failed to download item dump: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

async function main() {
  const text = await loadDump(process.argv[2]);

  const LINE = /^\s*\d+:\s*(\S+)\s*:\s*(.+?)\s*$/;
  /** @type {Map<string, Map<string, number>>} name -> (baseId -> maxEnchant) */
  const byName = new Map();
  let parsed = 0;

  for (const line of text.split(/\r?\n/)) {
    const match = LINE.exec(line);
    if (!match) continue;
    const [, uniqueName, displayName] = match;
    parsed++;

    const at = uniqueName.indexOf("@");
    const baseId = at === -1 ? uniqueName : uniqueName.slice(0, at);
    const enchant = at === -1 ? 0 : Number(uniqueName.slice(at + 1));
    if (!Number.isInteger(enchant)) continue;

    // Names shown for the vendor "?" placeholder carry no information.
    if (displayName === "?" || displayName === "") continue;

    const key = normalizeName(displayName);
    let candidates = byName.get(key);
    if (!candidates) byName.set(key, (candidates = new Map()));
    candidates.set(baseId, Math.max(candidates.get(baseId) ?? 0, enchant));
  }

  /** @type {Record<string, [string, number][]>} */
  const items = {};
  let ambiguous = 0;
  for (const [name, candidates] of byName) {
    const sorted = [...candidates.entries()].sort((a, b) => {
      const rank = candidateRank(a[0]) - candidateRank(b[0]);
      if (rank !== 0) return rank;
      if (a[0].length !== b[0].length) return a[0].length - b[0].length;
      return a[0] < b[0] ? -1 : 1;
    });
    if (sorted.length > 1) ambiguous++;
    items[name] = sorted.map(([id, maxEnchant]) => [id, maxEnchant]);
  }

  const index = {
    source: process.argv[2] ?? SOURCE_URL,
    generatedAt: new Date().toISOString(),
    lines: parsed,
    names: Object.keys(items).length,
    ambiguousNames: ambiguous,
    items,
  };

  writeFileSync(OUT, JSON.stringify(index), "utf8");
  console.log(
    `Wrote ${OUT}\n  ${parsed} dump lines -> ${index.names} display names (${ambiguous} ambiguous)`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
