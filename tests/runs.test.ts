import { describe, expect, it } from "vitest";
import { clusterRowsIntoRuns, parseChestLog } from "@/lib/parser";
import {
  layoutFromRuns,
  lineGroupsForCalculate,
  moveStack,
  reorderStack,
  stacksForRun,
  stackKey,
  tableItemsForRun,
  toggleStackExcluded,
} from "@/lib/runs";

function parsed(lines: string[]) {
  return parseChestLog(lines.join("\n")).rows;
}

const TWO_RUNS = [
  `"09/06/2026 11:52:07" "A" "Adept's Bag" "1" "4" "1"`,
  `"09/06/2026 11:52:08" "A" "Adept's Cape" "1" "4" "1"`,
  `"09/06/2026 14:00:00" "B" "Adept's Bag" "1" "4" "1"`,
];

describe("run layout", () => {
  it("stacks identical items only inside the same run", () => {
    const rows = parsed(TWO_RUNS);
    const layout = layoutFromRuns(clusterRowsIntoRuns(rows));
    const run1 = stacksForRun(rows, layout, 0);
    const run2 = stacksForRun(rows, layout, 1);
    expect(run1).toHaveLength(2);
    expect(run2).toHaveLength(1);
    expect(run2[0]).toMatchObject({ name: "Adept's Bag", amount: 1 });
    expect(run1.map((stack) => stack.name).sort()).toEqual(["Adept's Bag", "Adept's Cape"]);
  });

  it("sorts stacks by loot timestamp by default", () => {
    const rows = parsed(TWO_RUNS);
    const layout = layoutFromRuns(clusterRowsIntoRuns(rows));
    const run1 = stacksForRun(rows, layout, 0);
    expect(run1.map((stack) => stack.name)).toEqual(["Adept's Bag", "Adept's Cape"]);
    expect(run1[0].lootDate).toBe("09/06/2026 11:52:07");
  });

  it("moves a stack into another run and stacks it with a matching item", () => {
    const rows = parsed(TWO_RUNS);
    const clustered = clusterRowsIntoRuns(rows);
    const start = layoutFromRuns(clustered);
    const bag = stacksForRun(rows, start, 1)[0];
    const next = moveStack(start, rows, 1, 0, bag.key);
    const run1 = stacksForRun(rows, next, 0);
    const run2 = stacksForRun(rows, next, 1);
    expect(run2).toHaveLength(0);
    const movedBag = run1.find((stack) => stack.name === "Adept's Bag");
    expect(movedBag?.amount).toBe(2);
    expect(lineGroupsForCalculate(rows, next)[1]).toEqual([]);
    expect(next.slots).toBe(2);
  });

  it("soft-deletes a stack without removing it from the table", () => {
    const rows = parsed(TWO_RUNS);
    const layout = layoutFromRuns(clusterRowsIntoRuns(rows));
    const cape = stacksForRun(rows, layout, 0).find((stack) => stack.name === "Adept's Cape");
    if (!cape) throw new Error("missing cape");
    const excluded = toggleStackExcluded(layout, rows, 0, cape.key);
    const stacks = stacksForRun(rows, excluded, 0);
    expect(stacks).toHaveLength(2);
    expect(stacks.find((stack) => stack.name === "Adept's Cape")?.excluded).toBe(true);
    expect(lineGroupsForCalculate(rows, excluded)[0]).not.toContain(cape.lines[0]);
  });

  it("reorders stacks within a run", () => {
    const rows = parsed(TWO_RUNS);
    const layout = layoutFromRuns(clusterRowsIntoRuns(rows));
    const [bag, cape] = stacksForRun(rows, layout, 0);
    const next = reorderStack(layout, rows, 0, cape.key, bag.key);
    expect(stacksForRun(rows, next, 0).map((stack) => stack.name)).toEqual([
      "Adept's Cape",
      "Adept's Bag",
    ]);
  });

  it("resolves an in-game item id so the table can show that item's icon", () => {
    const rows = parsed(TWO_RUNS);
    const layout = layoutFromRuns(clusterRowsIntoRuns(rows));
    const items = tableItemsForRun(rows, layout, 0, null);
    const bag = items.find((item) => item.name === "Adept's Bag");
    expect(bag?.itemId).toBe("T4_BAG@1");
    expect(bag?.quality).toBe(4);
  });

  it("keeps stacks with no market price in the table, empty and flagged", () => {
    const rows = parsed(TWO_RUNS);
    const layout = layoutFromRuns(clusterRowsIntoRuns(rows));
    const items = tableItemsForRun(rows, layout, 0, {
      items: [
        {
          itemId: "T4_BAG@1",
          name: "Adept's Bag",
          enchantment: 1,
          quality: 4,
          amount: 1,
          unitPrice: 100_000,
          totalValue: 100_000,
          city: "Caerleon",
          priceDate: "2026-09-06T11:00:00",
          stale: false,
          players: ["A"],
          source: "sell_order",
        },
      ],
      missingPrices: [
        {
          itemId: "T4_CAPE@1",
          name: "Adept's Cape",
          enchantment: 1,
          quality: 4,
          amount: 1,
          reason: "No listing and no recorded sale in any market",
          players: ["A"],
        },
      ],
      unresolvedItems: [],
    } as never);
    const bag = items.find((item) => item.name === "Adept's Bag");
    const cape = items.find((item) => item.name === "Adept's Cape");
    expect(items).toHaveLength(2);
    expect(bag?.unitPrice).toBe(100_000);
    expect(bag?.priceIssue).toBeUndefined();
    expect(cape).toMatchObject({
      unitPrice: null,
      totalValue: null,
      priceIssue: "No listing and no recorded sale in any market",
    });
  });

  it("flags unresolved names in the same table instead of dropping them", () => {
    const rows = parsed([`"09/06/2026 11:52:07" "A" "Adept's Unknown Item" "0" "1" "1"`]);
    const layout = layoutFromRuns(clusterRowsIntoRuns(rows));
    const items = tableItemsForRun(rows, layout, 0, {
      items: [],
      missingPrices: [],
      unresolvedItems: [
        {
          name: "Adept's Unknown Item",
          enchantment: 0,
          quality: 1,
          amount: 1,
          players: ["A"],
          lines: [1],
          reason: "No Albion item matches this name",
        },
      ],
    } as never);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      name: "Adept's Unknown Item",
      unitPrice: null,
      priceIssue: "No Albion item matches this name",
    });
  });
});

describe("stackKey", () => {
  it("matches items by name, enchantment and quality", () => {
    expect(stackKey({ name: "Adept's Bag", enchantment: 1, quality: 4 })).toBe(
      stackKey({ name: "adept's  bag", enchantment: 1, quality: 4 }),
    );
  });
});
