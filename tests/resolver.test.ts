import { describe, expect, it } from "vitest";
import { buildItemId, normalizeName, resolveEntries } from "@/lib/resolver";
import type { AggregatedEntry } from "@/lib/types";

function entry(name: string, enchantment = 0, quality = 1, amount = 1): AggregatedEntry {
  return { name, enchantment, quality, amount, players: ["P"], lines: [1] };
}

function idFor(name: string, enchantment = 0, quality = 1): string | undefined {
  return resolveEntries([entry(name, enchantment, quality)]).resolved[0]?.itemId;
}

describe("normalizeName", () => {
  it("folds case, whitespace and typographic apostrophes", () => {
    expect(normalizeName("  Adept’s   Fiend  Cowl ")).toBe("adept's fiend cowl");
  });
});

describe("buildItemId", () => {
  it("omits @0 for unenchanted items", () => {
    expect(buildItemId("T4_BAG", 0)).toBe("T4_BAG");
    expect(buildItemId("T4_BAG", 2)).toBe("T4_BAG@2");
  });
});

describe("resolveEntries", () => {
  it("resolves armor with enchantment and quality", () => {
    const result = resolveEntries([entry("Adept's Fiend Cowl", 2, 4)]);
    expect(result.resolved[0]).toMatchObject({
      baseId: "T4_HEAD_CLOTH_HELL",
      itemId: "T4_HEAD_CLOTH_HELL@2",
      quality: 4,
    });
    expect(result.unresolved).toHaveLength(0);
  });

  it("resolves weapons, bags, capes, mounts and potions", () => {
    expect(idFor("Adept's Dagger Pair", 2)).toBe("T4_2H_DAGGERPAIR@2");
    expect(idFor("Adept's Bag", 1)).toBe("T4_BAG@1");
    expect(idFor("Adept's Cape", 2)).toBe("T4_CAPE@2");
    expect(idFor("Journeyman's Riding Horse")).toBe("T3_MOUNT_HORSE");
    expect(idFor("Invisibility Potion")).toBe("T8_POTION_CLEANSE");
    expect(idFor("Adept's Assassin Jacket", 2)).toBe("T4_ARMOR_LEATHER_SET3@2");
    expect(idFor("Adept's Hellion Shoes", 2)).toBe("T4_SHOES_LEATHER_HELL@2");
  });

  it("resolves every tier of the same item to its own id", () => {
    expect(idFor("Expert's Fiend Cowl")).toBe("T5_HEAD_CLOTH_HELL");
    expect(idFor("Elder's Fiend Cowl")).toBe("T8_HEAD_CLOTH_HELL");
  });

  it("ignores quality when building the id — quality is a market query parameter", () => {
    expect(idFor("Adept's Bag", 1, 1)).toBe(idFor("Adept's Bag", 1, 5));
  });

  it("tolerates typographic apostrophes and stray whitespace", () => {
    expect(idFor("Adept’s  Bag", 1)).toBe("T4_BAG@1");
  });

  it("reports unknown items instead of dropping them", () => {
    const result = resolveEntries([entry("Adept's Unknown Item", 2, 4, 2)]);
    expect(result.resolved).toHaveLength(0);
    expect(result.unresolved[0]).toMatchObject({ name: "Adept's Unknown Item", amount: 2 });
    expect(result.unresolved[0].reason).toMatch(/No Albion item matches/);
  });

  it("reports an enchantment the item does not have", () => {
    const result = resolveEntries([entry("Journeyman's Riding Horse", 3)]);
    expect(result.resolved).toHaveLength(0);
    expect(result.unresolved[0].reason).toMatch(/no enchantment 3/);
  });

  it("prefers the tradable id and lists alternatives for ambiguous names", () => {
    const result = resolveEntries([entry("Royal Blue Fireworks")]);
    expect(result.resolved[0].baseId).toBe("T3_VANITY_CONSUMABLE_FIREWORKS_BLUE");
    expect(result.resolved[0].alternatives).toContain(
      "T3_VANITY_CONSUMABLE_FIREWORKS_BLUE_NONTRADABLE",
    );
  });
});
