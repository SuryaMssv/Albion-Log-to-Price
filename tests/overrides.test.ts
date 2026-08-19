import { describe, expect, it } from "vitest";
import { applyManualPrices, overrideKey } from "@/lib/overrides";
import type { CalculationResult, MissingPriceItem, PricedItem } from "@/lib/types";

function priced(itemId: string, unitPrice: number, amount: number): PricedItem {
  return {
    itemId,
    name: itemId,
    enchantment: 0,
    quality: 4,
    amount,
    unitPrice,
    totalValue: unitPrice * amount,
    city: "Bridgewatch",
    priceDate: "2026-08-18T10:00:00",
    stale: false,
    players: ["P"],
    source: "sell_order",
  };
}

function missing(itemId: string, amount: number): MissingPriceItem {
  return {
    itemId,
    name: itemId,
    enchantment: 0,
    quality: 4,
    amount,
    reason: "no data",
    players: ["P"],
  };
}

function result(overrides: Partial<CalculationResult> = {}): CalculationResult {
  return {
    totalValue: 100_000,
    netValue: 100_000,
    repairCost: 0,
    sellerTaxPercent: 0,
    premium: true,
    marketSetupPercent: 2.5,
    marketTaxPercent: 4,
    sellerFee: 0,
    marketSetupFee: 0,
    marketTaxFee: 0,
    marketFee: 0,
    participants: 5,
    share: 20_000,
    remainder: 0,
    participantShares: [
      { name: "Ari", share: 20_000 },
      { name: "Bo", share: 20_000 },
      { name: "Player 3", share: 20_000 },
      { name: "Player 4", share: 20_000 },
      { name: "Player 5", share: 20_000 },
    ],
    items: [priced("T4_BAG@1", 100_000, 1)],
    unresolvedItems: [],
    missingPrices: [missing("T4_2H_DAGGERPAIR@2", 2), missing("T4_SHOES_LEATHER_HELL@2", 1)],
    parseErrors: [],
    priceBasis: "sell_min",
    server: "east",
    city: "Bridgewatch",
    stats: {
      rowsParsed: 4,
      rowsFailed: 0,
      stacks: 3,
      itemsPriced: 1,
      calculatedAt: "2026-08-18T12:00:00.000Z",
      marketMs: 500,
    },
    warnings: [],
    ...overrides,
  };
}

const AT = "2026-08-18T12:30:00.000Z";

describe("applyManualPrices", () => {
  it("returns the original result when nothing is overridden", () => {
    const original = result();
    expect(applyManualPrices(original, {}, AT)).toBe(original);
  });

  it("prices an item from a typed unit price and recomputes the split", () => {
    const updated = applyManualPrices(
      result(),
      { [overrideKey({ itemId: "T4_2H_DAGGERPAIR@2", quality: 4 })]: 90_000 },
      AT,
    );
    expect(updated.totalValue).toBe(280_000); // 100,000 + 90,000 x 2
    expect(updated.share).toBe(52_360);
    expect(updated.missingPrices.map((item) => item.itemId)).toEqual(["T4_SHOES_LEATHER_HELL@2"]);
    expect(updated.stats.itemsPriced).toBe(2);
  });

  it("marks the override as a manual price and keeps rows value-sorted", () => {
    const updated = applyManualPrices(
      result(),
      { [overrideKey({ itemId: "T4_2H_DAGGERPAIR@2", quality: 4 })]: 500_000 },
      AT,
    );
    expect(updated.items[0]).toMatchObject({
      itemId: "T4_2H_DAGGERPAIR@2",
      source: "manual",
      totalValue: 1_000_000,
      city: "Bridgewatch",
      priceDate: AT,
    });
    expect(updated.items[1].itemId).toBe("T4_BAG@1");
  });

  it("keeps participant names while re-splitting", () => {
    const updated = applyManualPrices(
      result(),
      { [overrideKey({ itemId: "T4_SHOES_LEATHER_HELL@2", quality: 4 })]: 1 },
      AT,
    );
    expect(updated.participantShares.map((p) => p.name)).toEqual([
      "Ari",
      "Bo",
      "Player 3",
      "Player 4",
      "Player 5",
    ]);
    expect(updated.participantShares[0].share).toBe(updated.share);
  });

  it("reports a remainder created by the override", () => {
    const updated = applyManualPrices(
      result(),
      { [overrideKey({ itemId: "T4_SHOES_LEATHER_HELL@2", quality: 4 })]: 3 },
      AT,
    );
    expect(updated.totalValue).toBe(100_003);
    expect(updated.share).toBe(18_700);
    expect(updated.remainder).toBe(3);
  });

  it("ignores blank, zero, negative and non-numeric entries", () => {
    const key = overrideKey({ itemId: "T4_2H_DAGGERPAIR@2", quality: 4 });
    for (const value of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(applyManualPrices(result(), { [key]: value }, AT).totalValue).toBe(100_000);
    }
  });

  it("rounds a fractional price to whole silver", () => {
    const updated = applyManualPrices(
      result(),
      { [overrideKey({ itemId: "T4_SHOES_LEATHER_HELL@2", quality: 4 })]: 1234.6 },
      AT,
    );
    expect(updated.items.find((item) => item.source === "manual")?.unitPrice).toBe(1235);
  });
});

describe("applyManualPrices — correcting an existing price", () => {
  it("overrides a market-priced row and re-splits", () => {
    const updated = applyManualPrices(
      result(),
      { [overrideKey({ itemId: "T4_BAG@1", quality: 4 })]: 27_000 },
      AT,
    );
    expect(updated.items[0]).toMatchObject({
      itemId: "T4_BAG@1",
      unitPrice: 27_000,
      totalValue: 27_000,
      source: "manual",
      stale: false,
      priceDate: AT,
    });
    expect(updated.totalValue).toBe(27_000);
    expect(updated.share).toBe(5_049);
  });

  it("clears the recent-sale count when a sale price is overridden", () => {
    const base = result({
      items: [{ ...priced("T4_BAG@1", 9_685, 1), source: "recent_sale", saleCount: 54, stale: true }],
    });
    const updated = applyManualPrices(
      base,
      { [overrideKey({ itemId: "T4_BAG@1", quality: 4 })]: 27_000 },
      AT,
    );
    expect(updated.items[0].saleCount).toBeUndefined();
    expect(updated.items[0].stale).toBe(false);
  });

  it("is a no-op when the typed price equals the market price", () => {
    const original = result();
    expect(applyManualPrices(original, { [overrideKey({ itemId: "T4_BAG@1", quality: 4 })]: 100_000 }, AT)).toBe(
      original,
    );
  });

  it("corrects a priced row and fills a missing one in the same pass", () => {
    const updated = applyManualPrices(
      result(),
      {
        [overrideKey({ itemId: "T4_BAG@1", quality: 4 })]: 27_000,
        [overrideKey({ itemId: "T4_2H_DAGGERPAIR@2", quality: 4 })]: 90_000,
      },
      AT,
    );
    expect(updated.totalValue).toBe(207_000); // 27,000 + 90,000 x 2
    expect(updated.items.filter((item) => item.source === "manual")).toHaveLength(2);
    expect(updated.missingPrices).toHaveLength(1);
  });
});
