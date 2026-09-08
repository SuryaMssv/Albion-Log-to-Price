import { describe, expect, it } from "vitest";
import {
  MAX_HISTORY,
  parseHistory,
  removeEntry,
  upsertEntry,
  type HistoryEntry,
} from "@/lib/history";
import { buildExportJson, parseExportJson } from "@/lib/export";
import type { CalculationResult } from "@/lib/types";

function snapshot() {
  return {
    totalValue: 1_000_000,
    netValue: 935_000,
    share: 187_000,
    remainder: 0,
    participantShares: [{ name: "Player 1", share: 187_000 }],
  };
}

function calculatorEntry(id: string, savedAt: string, gross = "1000000"): HistoryEntry {
  return {
    id,
    savedAt,
    source: "calculator",
    inputs: {
      gross,
      repairCost: "",
      sellerTax: "",
      guildTax: "",
      premium: true,
      participants: "5",
      useNames: false,
      names: [],
    },
    snapshot: snapshot(),
  };
}

function chestLogEntry(id: string, overrides: Record<string, number> = {}): HistoryEntry {
  return {
    id,
    savedAt: "2026-08-28T00:00:00.000Z",
    source: "chest-log",
    inputs: {
      log: `"Date" "Player" "Item" "Enchantment" "Quality" "Amount"\n"08/18/2026 11:49:51" "Ada" "Adept's Bag" "1" "4" "1"`,
      server: "east",
      city: "Bridgewatch",
      priceBasis: "sell_mid",
      participants: "5",
      useNames: true,
      names: ["Ada"],
      repairCost: "1000",
      sellerTax: "6",
      guildTax: "6",
      premium: true,
    },
    overrides,
    result: { totalValue: 1_000_000 } as CalculationResult,
    snapshot: snapshot(),
  };
}

describe("parseHistory", () => {
  it("returns an empty list for missing or invalid JSON", () => {
    expect(parseHistory(null)).toEqual([]);
    expect(parseHistory("not json")).toEqual([]);
    expect(parseHistory("{}")).toEqual([]);
  });

  it("keeps well-formed calculator and chest-log entries", () => {
    const entries = [calculatorEntry("a", "2026-08-28T01:00:00.000Z"), chestLogEntry("b")];
    expect(parseHistory(JSON.stringify(entries))).toEqual(entries);
  });

  it("keeps the run grouping window on a chest-log entry", () => {
    const entry = chestLogEntry("gap");
    if (entry.source !== "chest-log") throw new Error("expected chest-log");
    entry.inputs.runGapMinutes = 30;
    expect(parseHistory(JSON.stringify([entry]))).toEqual([entry]);
  });

  it("drops entries missing an id or source", () => {
    const raw = JSON.stringify([
      calculatorEntry("ok", "2026-08-28T01:00:00.000Z"),
      { savedAt: "x", source: "calculator" },
      { id: "no-source", savedAt: "x" },
    ]);
    expect(parseHistory(raw).map((entry) => entry.id)).toEqual(["ok"]);
  });
});

describe("upsertEntry", () => {
  it("inserts a new entry at the front", () => {
    const first = calculatorEntry("a", "2026-08-28T01:00:00.000Z");
    const second = calculatorEntry("b", "2026-08-28T02:00:00.000Z");
    expect(upsertEntry([first], second).map((entry) => entry.id)).toEqual(["b", "a"]);
  });

  it("updates an existing id and moves it to the front", () => {
    const older = calculatorEntry("a", "2026-08-28T01:00:00.000Z", "1");
    const other = calculatorEntry("b", "2026-08-28T02:00:00.000Z");
    const updated = calculatorEntry("a", "2026-08-28T03:00:00.000Z", "2");
    const next = upsertEntry([other, older], updated);
    expect(next.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(next[0].source === "calculator" && next[0].inputs.gross).toBe("2");
  });

  it(`keeps at most ${MAX_HISTORY} entries`, () => {
    let entries: HistoryEntry[] = [];
    for (let index = 0; index < MAX_HISTORY + 5; index += 1) {
      entries = upsertEntry(entries, calculatorEntry(`id-${index}`, `2026-08-28T00:00:${String(index).padStart(2, "0")}.000Z`));
    }
    expect(entries).toHaveLength(MAX_HISTORY);
    expect(entries[0].id).toBe(`id-${MAX_HISTORY + 4}`);
    expect(entries.at(-1)?.id).toBe("id-5");
  });
});

describe("removeEntry", () => {
  it("removes by id", () => {
    const entries = [calculatorEntry("a", "1"), calculatorEntry("b", "2")];
    expect(removeEntry(entries, "a").map((entry) => entry.id)).toEqual(["b"]);
  });
});

describe("parseExportJson", () => {
  it("round-trips a chest-log export", () => {
    const entry = chestLogEntry("split-1", { "T4_BAG@1|4": 12_000 });
    expect(parseExportJson(buildExportJson(entry))).toEqual(entry);
  });

  it("round-trips a calculator export", () => {
    const entry = calculatorEntry("calc-1", "2026-08-28T01:00:00.000Z", "9420000");
    expect(parseExportJson(buildExportJson(entry))).toEqual(entry);
  });

  it("rejects invalid or empty payloads", () => {
    expect(parseExportJson("")).toBeNull();
    expect(parseExportJson("not json")).toBeNull();
    expect(parseExportJson("{}")).toBeNull();
    expect(parseExportJson(JSON.stringify([calculatorEntry("a", "1")]))).toBeNull();
  });
});

describe("buildExportJson", () => {
  it("serializes log, user inputs, manual prices, and the split snapshot", () => {
    const entry = chestLogEntry("split-1", { "T4_BAG@1|4": 12_000 });
    const parsed = JSON.parse(buildExportJson(entry)) as HistoryEntry;
    expect(parsed.source).toBe("chest-log");
    if (parsed.source !== "chest-log") throw new Error("expected chest-log");
    expect(parsed.inputs.log).toContain("Adept's Bag");
    expect(parsed.inputs.city).toBe("Bridgewatch");
    expect(parsed.inputs.sellerTax).toBe("6");
    expect(parsed.overrides["T4_BAG@1|4"]).toBe(12_000);
    expect(parsed.snapshot.netValue).toBe(935_000);
  });
});
