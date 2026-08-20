import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { calculateLootSplit, validateInput, ValidationError } from "@/lib/calculate";
import { buildDiscordMessage } from "@/lib/discord";
import { buildCsv } from "@/lib/csv";
import { applyManualPrices, overrideKey } from "@/lib/overrides";
import type { Fetcher } from "@/lib/market";

// Price freshness is judged against the clock, so pin it — otherwise these assertions
// would drift from "fresh" to "stale" depending on when the suite happens to run.
beforeAll(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-08-18T11:00:00Z"));
});
afterAll(() => {
  vi.useRealTimers();
});

const SAMPLE = `"Date" "Player" "Item" "Enchantment" "Quality" "Amount"
"08/18/2026 11:49:51" "DemiG0Dz" "Adept's Fiend Cowl" "2" "4" "1"
"08/18/2026 11:49:51" "DemiG0Dz" "Adept's Bag" "1" "4" "1"
"08/18/2026 11:49:48" "DemiG0Dz" "Invisibility Potion" "0" "1" "2"
"08/18/2026 11:49:48" "DemiG0Dz" "Adept's Unknown Item" "0" "1" "1"
"08/18/2026 11:49:47" "DemiG0Dz" "Adept's Hellion Shoes" "2" "3" "1"`;

/**
 * Serves per-city prices for the sample log. Martlock is deliberately cheaper than
 * Caerleon so the selected city is observable in the total; the potion is listed only in
 * Thetford, which exercises the global tier; and the Hellion Shoes are listed nowhere at
 * all, which exercises the manual tier.
 */
const PRICES: Record<string, Record<string, number>> = {
  "T4_HEAD_CLOTH_HELL@2": { Caerleon: 900_000, Martlock: 800_000 },
  "T4_BAG@1": { Caerleon: 100_000, Martlock: 100_000 },
  T8_POTION_CLEANSE: { Thetford: 12_000 },
};

const ALL_CITIES = ["Caerleon", "Martlock", "Thetford", "Black Market"];

const fakeMarket: Fetcher = vi.fn(async (input: RequestInfo | URL) => {
  const url = new URL(String(input));
  const ids = decodeURIComponent(url.pathname.split("/prices/")[1]).split(",");
  const qualities = (url.searchParams.get("qualities") ?? "1").split(",").map(Number);
  const rows = ids.flatMap((id) =>
    qualities.flatMap((quality) =>
      ALL_CITIES.map((city) => {
        const price = PRICES[id]?.[city] ?? 0;
        return {
          item_id: id,
          city,
          quality,
          sell_price_min: price,
          sell_price_min_date: price ? "2026-08-18T10:00:00" : "0001-01-01T00:00:00",
          // A lowball buy order that must never be used as a valuation.
          buy_price_max: 30_000,
          buy_price_max_date: "2026-08-18T10:00:00",
        };
      }),
    ),
  );
  return new Response(JSON.stringify(rows), { status: 200 });
}) as unknown as Fetcher;

describe("validateInput", () => {
  it("accepts a well-formed request and defaults the optional fields", () => {
    const input = validateInput({ log: "x", participants: 5, city: "Martlock" });
    expect(input).toMatchObject({
      server: "east",
      city: "Martlock",
      priceBasis: "sell_mid",
      participants: 5,
      repairCost: 0,
      sellerTaxPercent: 0,
      guildTaxPercent: 0,
      premium: true,
    });
  });

  it("requires a city — there is no default market", () => {
    expect(() => validateInput({ log: "x", participants: 5 })).toThrow(/Select a city/);
    expect(() => validateInput({ log: "x", participants: 5, city: "  " })).toThrow(/Select a city/);
    expect(() => validateInput({ log: "x", participants: 5, city: "Atlantis" })).toThrow(
      /Unknown city "Atlantis"/,
    );
  });

  it("rejects the Black Market, which only ever posts buy orders", () => {
    expect(() => validateInput({ log: "x", participants: 5, city: "Black Market" })).toThrow(
      /Unknown city/,
    );
  });

  it("rejects an empty log, unknown server or basis, and bad participant counts", () => {
    expect(() => validateInput({ log: "  ", participants: 5, city: "Caerleon" })).toThrow(ValidationError);
    expect(() => validateInput({ log: "x", participants: 5, city: "Caerleon", server: "moon" })).toThrow(
      /Unknown server/,
    );
    expect(() =>
      validateInput({ log: "x", participants: 5, city: "Caerleon", price_basis: "sale_avg" }),
    ).toThrow(/price basis/);
    expect(() => validateInput({ log: "x", participants: 0, city: "Caerleon" })).toThrow(/Participants/);
    expect(() => validateInput({ log: "x", participants: 1000, city: "Caerleon" })).toThrow(/Participants/);
    expect(() => validateInput(null)).toThrow(ValidationError);
  });

  it("caps oversized logs and truncates participant names", () => {
    expect(() => validateInput({ log: "x".repeat(1_000_001), participants: 5, city: "Caerleon" })).toThrow(
      /too large/,
    );
    const input = validateInput({
      log: "x",
      city: "Caerleon",
      participants: 2,
      participant_names: ["a".repeat(80), "Bo", "extra"],
    });
    expect(input.participantNames).toEqual(["a".repeat(40), "Bo"]);
  });

  it("accepts repair cost, seller buffer tax, and premium flag", () => {
    expect(validateInput({ log: "x", participants: 5, city: "Martlock" })).toMatchObject({
      repairCost: 0,
      sellerTaxPercent: 0,
      guildTaxPercent: 0,
      premium: true,
    });
    const input = validateInput({
      log: "x",
      participants: 5,
      city: "Martlock",
      repair_cost: 300_000,
      seller_tax: 4,
      guild_tax: 10,
      premium: false,
    });
    expect(input).toMatchObject({
      repairCost: 300_000,
      sellerTaxPercent: 4,
      guildTaxPercent: 10,
      premium: false,
    });
  });

  it("rejects negative or oversized deductions", () => {
    expect(() =>
      validateInput({ log: "x", participants: 5, city: "Martlock", repair_cost: -1 }),
    ).toThrow(/Repair cost/);
    expect(() =>
      validateInput({ log: "x", participants: 5, city: "Martlock", seller_tax: 101 }),
    ).toThrow(/Seller buffer tax/);
    expect(() =>
      validateInput({ log: "x", participants: 5, city: "Martlock", guild_tax: 101 }),
    ).toThrow(/Guild tax/);
    expect(() =>
      validateInput({ log: "x", participants: 5, city: "Martlock", premium: "yes" }),
    ).toThrow(/Premium/);
  });
});

describe("calculateLootSplit", () => {
  it("runs the full pipeline and splits the total", async () => {
    const result = await calculateLootSplit(
      { log: SAMPLE, server: "east", city: "Caerleon", priceBasis: "sell_min", participants: 5 },
      fakeMarket,
    );

    expect(result.stats.rowsParsed).toBe(5);
    expect(result.stats.stacks).toBe(5);
    expect(result.city).toBe("Caerleon");
    // 900,000 cowl + 100,000 bag, both listed in Caerleon, plus the potion at 12,000 x 2
    // picked up from Thetford by the global tier.
    expect(result.totalValue).toBe(1_024_000);
    expect(result.marketFee).toBe(66_560);
    expect(result.netValue).toBe(957_440);
    expect(result.share).toBe(191_488);
    expect(result.remainder).toBe(0);
    expect(result.participantShares).toHaveLength(5);

    expect(result.items.map((item) => [item.itemId, item.source])).toEqual([
      ["T4_HEAD_CLOTH_HELL@2", "sell_order"],
      ["T4_BAG@1", "sell_order"],
      ["T8_POTION_CLEANSE", "global"],
    ]);

    // Unknown name is unresolved; the shoes exist nowhere, so they await a manual price.
    expect(result.unresolvedItems.map((item) => item.name)).toEqual(["Adept's Unknown Item"]);
    expect(result.missingPrices.map((item) => item.itemId)).toEqual(["T4_SHOES_LEATHER_HELL@2"]);
  });

  it("splits net after repair and selling fees", async () => {
    const result = await calculateLootSplit(
      {
        log: SAMPLE,
        server: "east",
        city: "Caerleon",
        priceBasis: "sell_min",
        participants: 5,
        repairCost: 300_000,
        sellerTaxPercent: 4,
        premium: true,
      },
      fakeMarket,
    );

    expect(result.totalValue).toBe(1_024_000);
    expect(result.sellerFee).toBe(40_960);
    expect(result.marketSetupFee).toBe(25_600);
    expect(result.marketTaxFee).toBe(40_960);
    expect(result.marketFee).toBe(66_560);
    expect(result.netValue).toBe(616_480);
    expect(result.share).toBe(123_296);
  });

  it("walks the fallback chain in order: city, then other markets, then sales", async () => {
    const result = await calculateLootSplit(
      { log: SAMPLE, server: "east", city: "Thetford", priceBasis: "sell_min", participants: 5 },
      fakeMarket,
    );
    const bySource = Object.fromEntries(result.items.map((item) => [item.itemId, item]));

    // Listed in Thetford, so the selected city wins outright.
    expect(bySource["T8_POTION_CLEANSE"]).toMatchObject({
      unitPrice: 12_000,
      source: "sell_order",
      city: "Thetford",
    });
    // Not in Thetford: median of Caerleon 900,000 and Martlock 800,000.
    expect(bySource["T4_HEAD_CLOTH_HELL@2"]).toMatchObject({
      unitPrice: 850_000,
      source: "global",
      globalMarkets: ["Caerleon", "Martlock"],
    });
  });

  it("values the selected city, not the cheapest one", async () => {
    const base = { log: SAMPLE, server: "east" as const, priceBasis: "sell_min" as const, participants: 5 };
    const caerleon = await calculateLootSplit({ ...base, city: "Caerleon" }, fakeMarket);
    const martlock = await calculateLootSplit({ ...base, city: "Martlock" }, fakeMarket);

    // Both include the same 24,000 of globally-priced potion; the difference is the cowl.
    expect(caerleon.totalValue).toBe(1_024_000);
    expect(martlock.totalValue).toBe(924_000);
    const cowl = (result: typeof caerleon) =>
      result.items.find((item) => item.itemId === "T4_HEAD_CLOTH_HELL@2");
    expect(cowl(caerleon)).toMatchObject({ unitPrice: 900_000, city: "Caerleon" });
    expect(cowl(martlock)).toMatchObject({ unitPrice: 800_000, city: "Martlock" });
  });

  it("ignores buy orders even when they are the only offer", async () => {
    // Every row in the stub carries a 30,000 buy order; none of it may be valued, at any
    // tier — including the shoes, which have no sell order anywhere.
    const result = await calculateLootSplit(
      { log: SAMPLE, server: "east", city: "Thetford", priceBasis: "sell_min", participants: 5 },
      fakeMarket,
    );
    expect(result.items.every((item) => item.unitPrice !== 30_000)).toBe(true);
    expect(result.missingPrices.map((item) => item.itemId)).toEqual(["T4_SHOES_LEATHER_HELL@2"]);
  });

  it("sorts the breakdown by value, descending", async () => {
    const result = await calculateLootSplit(
      { log: SAMPLE, server: "east", city: "Caerleon", priceBasis: "sell_min", participants: 5 },
      fakeMarket,
    );
    expect(result.items.map((item) => item.totalValue)).toEqual([900_000, 100_000, 24_000]);
  });

  it("reports a remainder when the total does not divide evenly", async () => {
    const result = await calculateLootSplit(
      { log: SAMPLE, server: "east", city: "Caerleon", priceBasis: "sell_min", participants: 3 },
      fakeMarket,
    );
    expect(result.totalValue).toBe(1_024_000);
    expect(result.share).toBe(319_146);
    expect(result.remainder).toBe(2);
  });

  it("refuses a log with no parseable rows", async () => {
    await expect(
      calculateLootSplit(
        { log: "not a chest log at all", server: "east", city: "Caerleon", priceBasis: "sell_min", participants: 5 },
        fakeMarket,
      ),
    ).rejects.toThrow(/Could not parse the chest log/);
  });

  it("still returns a total when the market is down, with everything flagged", async () => {
    const brokenMarket: Fetcher = vi.fn(async () => {
      throw new Error("market offline");
    }) as unknown as Fetcher;

    const result = await calculateLootSplit(
      { log: SAMPLE, server: "east", city: "Caerleon", priceBasis: "sell_min", participants: 5 },
      brokenMarket,
    );
    expect(result.totalValue).toBe(0);
    expect(result.items).toHaveLength(0);
    expect(result.missingPrices).toHaveLength(4);
    expect(result.missingPrices[0].reason).toMatch(/Market data was unavailable/);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe("output formats", () => {
  it("builds the Discord summary and flags exclusions", async () => {
    const result = await calculateLootSplit(
      {
        log: SAMPLE,
        server: "east",
        city: "Caerleon",
        priceBasis: "sell_min",
        participants: 3,
        participantNames: ["Ari", "Bo"],
      },
      fakeMarket,
    );
    const message = buildDiscordMessage(result);

    expect(message).toContain("⚔️ **GANK LOOT SPLIT**");
    expect(message).toContain("💰 Gross Value: **1,024,000**");
    expect(message).toContain("📉 Market setup (2.5%): −25,600");
    expect(message).toContain("📉 Market tax (4%): −40,960");
    expect(message).toContain("💰 Net Value: **957,440**");
    expect(message).toContain("👥 Participants: **3**");
    expect(message).toContain("🪙 Each: **319,146**");
    expect(message).toContain("↩️ Remainder: 2 silver");
    expect(message).toContain("• Ari — 319,146");
    expect(message).toContain("• Player 3 — 319,146");
    expect(message).toContain("⚠️ 2 item stack(s) excluded");
    expect(message).toContain("📊 Price: East — Caerleon lowest sell order");
  });

  it("exports every stack to CSV, including the excluded ones", async () => {
    const result = await calculateLootSplit(
      { log: SAMPLE, server: "east", city: "Caerleon", priceBasis: "sell_min", participants: 5 },
      fakeMarket,
    );
    const rows = buildCsv(result).split("\n");

    expect(rows[0]).toBe(
      "Item,Enchantment,Quality,Amount,Unit Price,Total Value,Market,Price Date,Source,Status",
    );
    expect(rows).toHaveLength(6); // header + 3 priced + 1 unpriced + 1 unresolved
    expect(rows.some((row) => row.includes("No market price"))).toBe(true);
    expect(rows.some((row) => row.includes("Unresolved"))).toBe(true);
    expect(rows[1]).toBe(
      "Adept's Fiend Cowl,2,4,1,900000,900000,Caerleon,2026-08-18T10:00:00,Sell order,Priced",
    );
  });

  it("keeps trash out of the CSV and does not fetch a market price for it", async () => {
    const fetcher = vi.fn(fakeMarket);
    const result = await calculateLootSplit(
      {
        log: `${SAMPLE}\n"08/19/2026 21:56:01" "lxlFactor" "Trash" "0" "1" "1"`,
        server: "east",
        city: "Caerleon",
        priceBasis: "sell_min",
        participants: 5,
      },
      fetcher,
    );

    expect(result.items.some((item) => /^trash$/i.test(item.name))).toBe(false);
    expect(result.unresolvedItems.some((item) => /^trash$/i.test(item.name))).toBe(false);
    expect(result.missingPrices.some((item) => /^trash$/i.test(item.name))).toBe(false);
    expect(buildCsv(result)).not.toMatch(/Trash/i);

    const requested = fetcher.mock.calls.map((call) => String(call[0])).join(" ");
    expect(requested).not.toMatch(/TRASH/i);
  });
});

describe("discord source notes", () => {
  it("calls out prices that did not come from a live listing", async () => {
    const result = await calculateLootSplit(
      { log: SAMPLE, server: "east", city: "Caerleon", priceBasis: "sell_min", participants: 5 },
      fakeMarket,
    );
    const withManual = applyManualPrices(
      { ...result, items: [{ ...result.items[0], source: "recent_sale", saleCount: 12 }] },
      { [overrideKey(result.missingPrices[0])]: 5_000 },
      "2026-08-18T12:30:00.000Z",
    );
    expect(buildDiscordMessage(withManual)).toContain("ℹ️ 1 from recent sales, 1 manually priced.");
  });

  it("says nothing about sources when every price is a live listing", async () => {
    const result = await calculateLootSplit(
      { log: SAMPLE, server: "east", city: "Caerleon", priceBasis: "sell_min", participants: 5 },
      fakeMarket,
    );
    expect(buildDiscordMessage(result)).not.toContain("ℹ️");
  });
});
