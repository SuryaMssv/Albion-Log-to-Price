import { describe, expect, it } from "vitest";
import {
  buildParticipantShares,
  computeSplit,
  itemValue,
  priceEntries,
  totalValue,
} from "@/lib/calculator";
import { quoteKey, type MarketLookup } from "@/lib/market";
import type { PricedItem, ResolvedEntry } from "@/lib/types";

type Quote = { price: number; maxPrice?: number; city: string; date: string };

function lookup(
  entries: Record<string, Quote>,
  elsewhere: Record<string, Quote[]> = {},
): MarketLookup {
  return {
    quotes: new Map(Object.entries(entries)),
    elsewhere: new Map(Object.entries(elsewhere)),
    warnings: [],
    totalFailure: false,
  };
}

function resolved(itemId: string, quality: number, amount: number): ResolvedEntry {
  return {
    name: itemId,
    baseId: itemId.split("@")[0],
    itemId,
    enchantment: 0,
    quality,
    amount,
    players: ["P"],
    lines: [1],
  };
}

describe("itemValue", () => {
  it("multiplies unit price by amount (FR-07)", () => {
    expect(itemValue(250_000, 4)).toBe(1_000_000);
    expect(itemValue(250_000, 3)).toBe(750_000);
  });

  it("rounds fractional prices to whole silver", () => {
    expect(itemValue(1234.6, 2)).toBe(2470);
  });
});

describe("computeSplit", () => {
  it("splits evenly", () => {
    expect(computeSplit(1000, 5)).toEqual({ share: 200, remainder: 0 });
    expect(computeSplit(4_800_000, 5)).toEqual({ share: 960_000, remainder: 0 });
  });

  it("reports the remainder when the total does not divide evenly", () => {
    expect(computeSplit(1001, 5)).toEqual({ share: 200, remainder: 1 });
    expect(computeSplit(1_000_001, 3)).toEqual({ share: 333_333, remainder: 2 });
  });

  it("handles a single participant and a zero total", () => {
    expect(computeSplit(4_800_000, 1)).toEqual({ share: 4_800_000, remainder: 0 });
    expect(computeSplit(0, 5)).toEqual({ share: 0, remainder: 0 });
  });

  it("rejects an invalid participant count", () => {
    expect(() => computeSplit(1000, 0)).toThrow(RangeError);
    expect(() => computeSplit(1000, 2.5)).toThrow(RangeError);
  });

  it("never distributes more than the total", () => {
    const { share, remainder } = computeSplit(1_000_001, 7);
    expect(share * 7 + remainder).toBe(1_000_001);
  });
});

describe("buildParticipantShares", () => {
  it("falls back to numbered players", () => {
    expect(buildParticipantShares(3, 100)).toEqual([
      { name: "Player 1", share: 100 },
      { name: "Player 2", share: 100 },
      { name: "Player 3", share: 100 },
    ]);
  });

  it("uses provided names and fills the gaps", () => {
    expect(buildParticipantShares(3, 100, ["Ari", "  ", "Bo"])).toEqual([
      { name: "Ari", share: 100 },
      { name: "Player 2", share: 100 },
      { name: "Bo", share: 100 },
    ]);
  });
});

describe("priceEntries", () => {
  const now = Date.parse("2026-08-18T12:00:00Z");

  it("prices resolved stacks and totals them", () => {
    const result = priceEntries(
      [resolved("T4_BAG@1", 4, 3), resolved("T4_CAPE@2", 3, 1)],
      lookup({
        [quoteKey("T4_BAG@1", 4)]: { price: 15_502, city: "Martlock", date: "2026-08-18T10:00:00" },
        [quoteKey("T4_CAPE@2", 3)]: { price: 90_978, city: "Martlock", date: "2026-08-18T09:00:00" },
      }),
      "Martlock",
      { now, basis: "sell_min" },
    );
    expect(result.missing).toHaveLength(0);
    expect(result.priced.map((item: PricedItem) => item.totalValue)).toEqual([46_506, 90_978]);
    expect(totalValue(result.priced)).toBe(137_484);
  });

  it("matches quotes per quality, not just per item", () => {
    const result = priceEntries(
      [resolved("T4_BAG@1", 4, 1)],
      lookup({ [quoteKey("T4_BAG@1", 1)]: { price: 100, city: "Caerleon", date: "2026-08-18T10:00:00" } }),
      "Caerleon",
      { now },
    );
    expect(result.priced).toHaveLength(0);
    expect(result.missing[0].reason).toMatch(/No listing and no recorded sale in any market/);
  });

  it("never assigns a zero price to an unpriced item (FR-16)", () => {
    const result = priceEntries([resolved("T4_BAG@1", 4, 3)], lookup({}), "Caerleon", { now });
    expect(result.priced).toHaveLength(0);
    expect(result.missing[0]).toMatchObject({ itemId: "T4_BAG@1", amount: 3 });
    expect(totalValue(result.priced)).toBe(0);
  });

  it("flags prices older than the freshness window", () => {
    const result = priceEntries(
      [resolved("T4_BAG@1", 4, 1)],
      lookup({ [quoteKey("T4_BAG@1", 4)]: { price: 100, city: "Caerleon", date: "2026-07-01T10:00:00" } }),
      "Caerleon",
      { now },
    );
    expect(result.priced[0].stale).toBe(true);
  });

  it("falls back to a recent completed sale when nothing is listed", () => {
    const result = priceEntries(
      [resolved("T4_ARMOR_LEATHER_SET3@2", 4, 2)],
      lookup({}),
      "Bridgewatch",
      {
        now,
        history: {
          sales: new Map([
            [
              quoteKey("T4_ARMOR_LEATHER_SET3@2", 4),
              { price: 29_044, city: "Bridgewatch", date: "2026-08-16T00:00:00", saleCount: 22 },
            ],
          ]),
          elsewhere: new Map(),
          warnings: [],
        },
      },
    );
    expect(result.missing).toHaveLength(0);
    expect(result.priced[0]).toMatchObject({
      unitPrice: 29_044,
      totalValue: 58_088,
      source: "recent_sale",
      saleCount: 22,
      city: "Bridgewatch",
    });
  });

  it("prefers a live sell order over a recorded sale", () => {
    const key = quoteKey("T4_BAG@1", 4);
    const result = priceEntries(
      [resolved("T4_BAG@1", 4, 1)],
      lookup({ [key]: { price: 9_685, city: "Bridgewatch", date: "2026-08-18T10:00:00" } }),
      "Bridgewatch",
      {
        now,
        history: {
          sales: new Map([
            [key, { price: 50_000, city: "Bridgewatch", date: "2026-08-17T00:00:00", saleCount: 9 }],
          ]),
          elsewhere: new Map(),
          warnings: [],
        },
      },
    );
    expect(result.priced[0]).toMatchObject({ unitPrice: 9_685, source: "sell_order" });
    // The sale is still reported as corroborating context — 50,000 vs 9,685 is a big gap.
    expect(result.priced[0].crossCheck).toEqual({ label: "sold avg (9)", price: 50_000 });
  });

  it("marks a live sell order as its own source", () => {
    const result = priceEntries(
      [resolved("T4_BAG@1", 4, 1)],
      lookup({ [quoteKey("T4_BAG@1", 4)]: { price: 100, city: "Caerleon", date: "2026-08-18T10:00:00" } }),
      "Caerleon",
      { now },
    );
    expect(result.priced[0].source).toBe("sell_order");
  });

  it("splits the listing range by default", () => {
    const key = quoteKey("T4_BAG@1", 4);
    const result = priceEntries(
      [resolved("T4_BAG@1", 4, 1)],
      lookup({
        [key]: { price: 9_685, maxPrice: 31_255, city: "Bridgewatch", date: "2026-08-18T10:00:00" },
      }),
      "Bridgewatch",
      { now },
    );
    expect(result.priced[0]).toMatchObject({ unitPrice: 20_470, source: "sell_mid" });
    expect(result.priced[0].spread).toEqual({ min: 9_685, max: 31_255 });
  });

  it("falls back to the lowest listing when there is no range", () => {
    const key = quoteKey("T4_BAG@1", 4);
    const result = priceEntries(
      [resolved("T4_BAG@1", 4, 1)],
      lookup({ [key]: { price: 11_079, city: "Caerleon", date: "2026-08-18T10:00:00" } }),
      "Caerleon",
      { now },
    );
    expect(result.priced[0]).toMatchObject({ unitPrice: 11_079, source: "sell_order" });
    expect(result.priced[0].spread).toBeUndefined();
  });

  it("stays quiet when the two sources broadly agree", () => {
    const key = quoteKey("T4_BAG@1", 4);
    const result = priceEntries(
      [resolved("T4_BAG@1", 4, 1)],
      lookup({ [key]: { price: 20_000, city: "Bridgewatch", date: "2026-08-18T10:00:00" } }),
      "Bridgewatch",
      {
        now,
        history: {
          sales: new Map([
            [key, { price: 21_000, city: "Bridgewatch", date: "2026-08-17T00:00:00", saleCount: 7 }],
          ]),
          elsewhere: new Map(),
          warnings: [],
        },
      },
    );
    expect(result.priced[0].crossCheck).toBeUndefined();
  });

  it("uses a sale from another market when nothing is listed anywhere", () => {
    const key = quoteKey("T4_ARMOR_LEATHER_SET3@2", 4);
    const result = priceEntries(
      [resolved("T4_ARMOR_LEATHER_SET3@2", 4, 1)],
      lookup({}),
      "Martlock",
      {
        now,
        history: {
          sales: new Map(),
          elsewhere: new Map([
            [
              key,
              [
                { price: 42_772, city: "Bridgewatch", date: "2026-08-16T00:00:00", saleCount: 380 },
                { price: 36_000, city: "Lymhurst", date: "2026-08-15T00:00:00", saleCount: 12 },
              ],
            ],
          ]),
          warnings: [],
        },
      },
    );
    expect(result.priced[0]).toMatchObject({
      unitPrice: 39_386, // median of the two markets
      source: "recent_sale",
      globalMarkets: ["Bridgewatch", "Lymhurst"],
    });
  });

  it("prefers the selected city's own sales over other markets'", () => {
    const key = quoteKey("T4_BAG@1", 4);
    const result = priceEntries(
      [resolved("T4_BAG@1", 4, 1)],
      lookup({}),
      "Martlock",
      {
        now,
        history: {
          sales: new Map([
            [key, { price: 21_000, city: "Martlock", date: "2026-08-17T00:00:00", saleCount: 7 }],
          ]),
          elsewhere: new Map([
            [key, [{ price: 5_000, city: "Caerleon", date: "2026-08-17T00:00:00", saleCount: 90 }]],
          ]),
          warnings: [],
        },
      },
    );
    expect(result.priced[0]).toMatchObject({ unitPrice: 21_000, city: "Martlock" });
    expect(result.priced[0].globalMarkets).toBeUndefined();
  });

  it("explains that the market itself was unavailable", () => {
    const failed: MarketLookup = {
      quotes: new Map(),
      elsewhere: new Map(),
      warnings: ["boom"],
      totalFailure: true,
    };
    const result = priceEntries([resolved("T4_BAG@1", 4, 1)], failed, "Caerleon", { now });
    expect(result.missing[0].reason).toMatch(/Market data was unavailable/);
  });

  it("stamps every priced row with the selected city", () => {
    const result = priceEntries(
      [resolved("T4_BAG@1", 4, 1)],
      lookup({ [quoteKey("T4_BAG@1", 4)]: { price: 100, city: "Thetford", date: "2026-08-18T10:00:00" } }),
      "Thetford",
      { now },
    );
    expect(result.priced[0].city).toBe("Thetford");
  });

  it("prices from other markets when the selected city has no listing", () => {
    const result = priceEntries(
      [resolved("T4_BAG@1", 4, 2)],
      lookup(
        {},
        {
          [quoteKey("T4_BAG@1", 4)]: [
            { price: 20_000, city: "Bridgewatch", date: "2026-08-18T10:00:00" },
            { price: 22_000, city: "Lymhurst", date: "2026-08-18T11:00:00" },
            { price: 60_000, city: "Thetford", date: "2026-08-18T09:00:00" },
          ],
        },
      ),
      "Martlock",
      { now },
    );
    expect(result.missing).toHaveLength(0);
    expect(result.priced[0]).toMatchObject({
      unitPrice: 22_000, // median, so the 60,000 outlier does not carry the row
      totalValue: 44_000,
      source: "global",
      globalMarkets: ["Bridgewatch", "Lymhurst", "Thetford"],
    });
    expect(result.priced[0].priceDate).toBe("2026-08-18T11:00:00");
  });

  it("applies the chosen basis to other markets too", () => {
    const result = priceEntries(
      [resolved("T4_BAG@1", 4, 1)],
      lookup(
        {},
        {
          [quoteKey("T4_BAG@1", 4)]: [
            { price: 9_685, maxPrice: 31_255, city: "Bridgewatch", date: "2026-08-18T10:00:00" },
          ],
        },
      ),
      "Martlock",
      { now },
    );
    expect(result.priced[0].unitPrice).toBe(20_470);
  });

  it("prefers the selected city over other markets, even when they are cheaper", () => {
    const key = quoteKey("T4_BAG@1", 4);
    const result = priceEntries(
      [resolved("T4_BAG@1", 4, 1)],
      lookup(
        { [key]: { price: 50_000, city: "Martlock", date: "2026-08-18T10:00:00" } },
        { [key]: [{ price: 10_000, city: "Bridgewatch", date: "2026-08-18T10:00:00" }] },
      ),
      "Martlock",
      { now },
    );
    expect(result.priced[0]).toMatchObject({ unitPrice: 50_000, source: "sell_order" });
  });

  it("prefers other markets over a recorded sale", () => {
    const key = quoteKey("T4_BAG@1", 4);
    const result = priceEntries(
      [resolved("T4_BAG@1", 4, 1)],
      lookup({}, { [key]: [{ price: 20_000, city: "Bridgewatch", date: "2026-08-18T10:00:00" }] }),
      "Martlock",
      {
        now,
        history: {
          sales: new Map([
            [key, { price: 5_000, city: "Martlock", date: "2026-08-17T00:00:00", saleCount: 7 }],
          ]),
          elsewhere: new Map(),
          warnings: [],
        },
      },
    );
    expect(result.priced[0]).toMatchObject({ unitPrice: 20_000, source: "global" });
  });

  it("goes to manual only when nothing anywhere has a price", () => {
    const result = priceEntries([resolved("T4_BAG@1", 4, 2)], lookup({}), "Martlock", { now });
    expect(result.priced).toHaveLength(0);
    expect(result.missing[0].reason).toBe(
      "No listing and no recorded sale in any market for this item at quality 4.",
    );
  });
});
