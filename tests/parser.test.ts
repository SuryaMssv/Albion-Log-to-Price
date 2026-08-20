import { describe, expect, it } from "vitest";
import { aggregateRows, parseChestLog, tokenizeLine } from "@/lib/parser";

const SAMPLE = `"Date" "Player" "Item" "Enchantment" "Quality" "Amount"
"08/18/2026 11:49:51" "DemiG0Dz" "Adept's Fiend Cowl" "2" "4" "1"
"08/18/2026 11:49:51" "DemiG0Dz" "Adept's Bag" "1" "4" "1"
"08/18/2026 11:49:50" "DemiG0Dz" "Adept's Cape" "2" "3" "1"
"08/18/2026 11:49:50" "DemiG0Dz" "Journeyman's Riding Horse" "0" "1" "1"
"08/18/2026 11:49:49" "DemiG0Dz" "Adept's Dagger Pair" "2" "4" "1"
"08/18/2026 11:49:49" "DemiG0Dz" "Adept's Assassin Jacket" "2" "4" "1"
"08/18/2026 11:49:49" "DemiG0Dz" "Adept's Hellion Shoes" "2" "3" "1"
"08/18/2026 11:49:48" "DemiG0Dz" "Invisibility Potion" "0" "1" "2"`;

describe("tokenizeLine", () => {
  it("keeps quoted item names with spaces and apostrophes intact", () => {
    expect(tokenizeLine('"08/18/2026 11:49:51" "DemiG0Dz" "Adept\'s Fiend Cowl" "2" "4" "1"')).toEqual([
      "08/18/2026 11:49:51",
      "DemiG0Dz",
      "Adept's Fiend Cowl",
      "2",
      "4",
      "1",
    ]);
  });

  it("supports tab-separated exports", () => {
    expect(tokenizeLine("08/18/2026\tPlayer\tAdept's Bag\t1\t4\t1")).toEqual([
      "08/18/2026",
      "Player",
      "Adept's Bag",
      "1",
      "4",
      "1",
    ]);
  });

  it("supports comma-separated exports with quoted commas", () => {
    expect(tokenizeLine('08/18/2026,Player,"Bag, Big",1,4,1')).toEqual([
      "08/18/2026",
      "Player",
      "Bag, Big",
      "1",
      "4",
      "1",
    ]);
  });
});

describe("parseChestLog", () => {
  it("parses every row of the sample log and skips the header", () => {
    const result = parseChestLog(SAMPLE);
    expect(result.rows).toHaveLength(8);
    expect(result.errors).toHaveLength(0);
    expect(result.rows[0]).toEqual({
      line: 2,
      date: "08/18/2026 11:49:51",
      player: "DemiG0Dz",
      item: "Adept's Fiend Cowl",
      enchantment: 2,
      quality: 4,
      amount: 1,
    });
  });

  it("parses a log with no header row", () => {
    const withoutHeader = SAMPLE.split("\n").slice(1).join("\n");
    expect(parseChestLog(withoutHeader).rows).toHaveLength(8);
  });

  it("preserves apostrophes in item names", () => {
    const rows = parseChestLog(SAMPLE).rows;
    expect(rows.map((row) => row.item)).toContain("Journeyman's Riding Horse");
  });

  it("ignores blank lines without reporting errors", () => {
    const result = parseChestLog(`\n\n${SAMPLE}\n\n   \n`);
    expect(result.rows).toHaveLength(8);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts enchantment 0, quality 1 and quality 5", () => {
    const log = [
      '"08/18/2026" "P" "Invisibility Potion" "0" "1" "1"',
      '"08/18/2026" "P" "Adept\'s Bag" "4" "5" "1"',
    ].join("\n");
    const result = parseChestLog(log);
    expect(result.errors).toHaveLength(0);
    expect(result.rows[0].enchantment).toBe(0);
    expect(result.rows[0].quality).toBe(1);
    expect(result.rows[1].quality).toBe(5);
  });

  it("accepts large, comma-grouped quantities", () => {
    const result = parseChestLog('"08/18/2026" "P" "Adept\'s Bag" "0" "1" "12,500"');
    expect(result.rows[0].amount).toBe(12500);
  });

  it("reports rows with missing fields instead of dropping them", () => {
    const result = parseChestLog(`${SAMPLE}\n"08/18/2026" "Player" "Adept's Bag"`);
    expect(result.rows).toHaveLength(8);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].line).toBe(10);
    expect(result.errors[0].reason).toMatch(/Expected 6 columns/);
  });

  it("reports out-of-range enchantment and quality with the offending line", () => {
    const result = parseChestLog(
      [
        '"08/18/2026" "P" "Adept\'s Bag" "9" "4" "1"',
        '"08/18/2026" "P" "Adept\'s Bag" "1" "0" "1"',
        '"08/18/2026" "P" "Adept\'s Bag" "1" "4" "0"',
        '"08/18/2026" "P" "Adept\'s Bag" "1" "4" "x"',
      ].join("\n"),
    );
    expect(result.rows).toHaveLength(0);
    expect(result.errors.map((error) => error.line)).toEqual([1, 2, 3, 4]);
    expect(result.errors[0].reason).toMatch(/Enchantment/);
    expect(result.errors[1].reason).toMatch(/Quality/);
    expect(result.errors[2].reason).toMatch(/Amount/);
  });

  it("reports an empty item name", () => {
    const result = parseChestLog('"08/18/2026" "P" "" "1" "4" "1"');
    expect(result.errors[0].reason).toMatch(/Item name is empty/);
  });

  it("honours a re-ordered header row", () => {
    const log = [
      '"Item" "Amount" "Quality" "Enchantment" "Player" "Date"',
      '"Adept\'s Bag" "3" "4" "1" "DemiG0Dz" "08/18/2026"',
    ].join("\n");
    const result = parseChestLog(log);
    expect(result.errors).toHaveLength(0);
    expect(result.rows[0]).toMatchObject({
      item: "Adept's Bag",
      amount: 3,
      quality: 4,
      enchantment: 1,
      player: "DemiG0Dz",
    });
  });
});

describe("aggregateRows", () => {
  it("merges identical item + enchantment + quality stacks", () => {
    const log = [
      '"08/18/2026" "A" "Adept\'s Bag" "2" "4" "1"',
      '"08/18/2026" "B" "Adept\'s Bag" "2" "4" "3"',
      '"08/18/2026" "A" "Adept\'s Bag" "2" "3" "5"',
    ].join("\n");
    const stacks = aggregateRows(parseChestLog(log).rows);
    expect(stacks).toHaveLength(2);
    expect(stacks[0]).toMatchObject({ amount: 4, quality: 4, players: ["A", "B"] });
    expect(stacks[0].lines).toEqual([1, 2]);
    expect(stacks[1]).toMatchObject({ amount: 5, quality: 3 });
  });

  it("treats case and spacing differences as the same item", () => {
    const log = [
      '"08/18/2026" "A" "Adept\'s  Bag" "0" "1" "1"',
      '"08/18/2026" "A" "adept\'s bag" "0" "1" "2"',
    ].join("\n");
    const stacks = aggregateRows(parseChestLog(log).rows);
    expect(stacks).toHaveLength(1);
    expect(stacks[0].amount).toBe(3);
  });

  it("nets a remove-then-reinsert to quantity 1, not 2", () => {
    // Newest-first chest copy: take the cape out (-1), then put it back (+1).
    // The withdrawal must cancel, not be dropped (which would count the cape twice)
    // and must not wipe a later re-insert that sits above it in the paste.
    const log = [
      '"Date"\t"Player"\t"Item"\t"Enchantment"\t"Quality"\t"Amount"',
      '"08/19/2026 21:57:39"\t"DemiG0Dz"\t"Adept\'s Avalonian Cape"\t"2"\t"1"\t"1"',
      '"08/19/2026 21:56:07"\t"DemiG0Dz"\t"Major Sticky Potion"\t"0"\t"1"\t"1"',
      '"08/19/2026 21:56:07"\t"DemiG0Dz"\t"Adept\'s Avalonian Cape"\t"2"\t"1"\t"-1"',
    ].join("\n");
    const parsed = parseChestLog(log);
    expect(parsed.errors).toHaveLength(0);
    expect(parsed.rows.map((row) => row.amount)).toEqual([1, 1, -1]);

    const stacks = aggregateRows(parsed.rows);
    const cape = stacks.find((stack) => stack.name === "Adept's Avalonian Cape");
    const potion = stacks.find((stack) => stack.name === "Major Sticky Potion");
    expect(cape?.amount).toBe(1);
    expect(potion?.amount).toBe(1);
  });

  it("drops a stack that was fully withdrawn", () => {
    const log = [
      '"08/19/2026 21:55:00" "P" "Adept\'s Avalonian Cape" "2" "1" "1"',
      '"08/19/2026 21:56:00" "P" "Adept\'s Avalonian Cape" "2" "1" "-1"',
    ].join("\n");
    const stacks = aggregateRows(parseChestLog(log).rows);
    expect(stacks).toHaveLength(0);
  });

  it("omits trash so it is never listed or priced", () => {
    const log = [
      '"08/19/2026 21:56:01" "lxlFactor" "Trash" "0" "1" "1"',
      '"08/19/2026 21:56:07" "DemiG0Dz" "Major Sticky Potion" "0" "1" "1"',
      '"08/19/2026 21:56:08" "lxlFactor" "TRASH" "0" "1" "2"',
    ].join("\n");
    const stacks = aggregateRows(parseChestLog(log).rows);
    expect(stacks).toHaveLength(1);
    expect(stacks[0].name).toBe("Major Sticky Potion");
  });
});
