import { describe, expect, it } from "vitest";
import { applyDeductions, computeNet } from "@/lib/deductions";
import { buildDiscordMessage } from "@/lib/discord";
import type { CalculationResult, PricedItem } from "@/lib/types";

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

function result(overrides: Partial<CalculationResult> = {}): CalculationResult {
  return {
    totalValue: 1_000_000,
    netValue: 1_000_000,
    repairCost: 0,
    sellerTaxPercent: 0,
    marketTaxPercent: 0,
    sellerFee: 0,
    marketFee: 0,
    participants: 5,
    share: 200_000,
    remainder: 0,
    participantShares: Array.from({ length: 5 }, (_, index) => ({
      name: `Player ${index + 1}`,
      share: 200_000,
    })),
    items: [priced("T4_BAG@1", 1_000_000, 1)],
    unresolvedItems: [],
    missingPrices: [],
    parseErrors: [],
    priceBasis: "sell_mid",
    server: "east",
    city: "Bridgewatch",
    stats: {
      rowsParsed: 1,
      rowsFailed: 0,
      stacks: 1,
      itemsPriced: 1,
      calculatedAt: "2026-08-18T12:00:00.000Z",
      marketMs: 10,
    },
    warnings: [],
    ...overrides,
  };
}

describe("computeNet", () => {
  it("leaves net equal to gross when every deduction is zero", () => {
    expect(computeNet(1_000_000, { repairCost: 0, sellerTaxPercent: 0, marketTaxPercent: 0 })).toEqual({
      repairCost: 0,
      sellerTaxPercent: 0,
      marketTaxPercent: 0,
      sellerFee: 0,
      marketFee: 0,
      netValue: 1_000_000,
    });
  });

  it("subtracts repair as silver, then percentage taxes of gross", () => {
    // 1,000,000 - 300,000 repair - 4% seller - 2.5% market
    expect(computeNet(1_000_000, { repairCost: 300_000, sellerTaxPercent: 4, marketTaxPercent: 2.5 })).toEqual({
      repairCost: 300_000,
      sellerTaxPercent: 4,
      marketTaxPercent: 2.5,
      sellerFee: 40_000,
      marketFee: 25_000,
      netValue: 635_000,
    });
  });

  it("charges tax on gross, not on (gross − repair)", () => {
    const withRepair = computeNet(1_000_000, {
      repairCost: 300_000,
      sellerTaxPercent: 10,
      marketTaxPercent: 0,
    });
    expect(withRepair.sellerFee).toBe(100_000);
    expect(withRepair.netValue).toBe(600_000);
  });

  it("rounds fees to whole silver", () => {
    expect(computeNet(1_000_001, { repairCost: 0, sellerTaxPercent: 2.5, marketTaxPercent: 0 }).sellerFee).toBe(
      25_000,
    );
  });

  it("floors net at zero when deductions exceed gross", () => {
    expect(
      computeNet(100_000, { repairCost: 300_000, sellerTaxPercent: 0, marketTaxPercent: 0 }).netValue,
    ).toBe(0);
  });
});

describe("applyDeductions", () => {
  it("splits net, not gross", () => {
    const updated = applyDeductions(result(), {
      repairCost: 300_000,
      sellerTaxPercent: 4,
      marketTaxPercent: 2.5,
    });
    expect(updated.totalValue).toBe(1_000_000);
    expect(updated.netValue).toBe(635_000);
    expect(updated.share).toBe(127_000);
    expect(updated.remainder).toBe(0);
    expect(updated.participantShares.every((participant) => participant.share === 127_000)).toBe(true);
  });

  it("keeps the original result when nothing is deducted", () => {
    const original = result();
    expect(applyDeductions(original, { repairCost: 0, sellerTaxPercent: 0, marketTaxPercent: 0 })).toBe(
      original,
    );
  });

  it("reports remainder against net", () => {
    const updated = applyDeductions(result({ participants: 3 }), {
      repairCost: 2,
      sellerTaxPercent: 0,
      marketTaxPercent: 0,
    });
    expect(updated.netValue).toBe(999_998);
    expect(updated.share).toBe(333_332);
    expect(updated.remainder).toBe(2);
  });
});

describe("Discord deductions", () => {
  it("keeps the gross-only summary when fees are zero", () => {
    const message = buildDiscordMessage(result());
    expect(message).toContain("💰 Total Value: **1,000,000**");
    expect(message).not.toContain("Repair");
    expect(message).not.toContain("Net Value");
  });

  it("lists repair and selling fees, then splits net", () => {
    const message = buildDiscordMessage(
      applyDeductions(result(), { repairCost: 300_000, sellerTaxPercent: 4, marketTaxPercent: 2.5 }),
    );
    expect(message).toContain("💰 Gross Value: **1,000,000**");
    expect(message).toContain("🔧 Repair: −300,000");
    expect(message).toContain("📉 Seller's tax (4%): −40,000");
    expect(message).toContain("📉 Market tax (2.5%): −25,000");
    expect(message).toContain("💰 Net Value: **635,000**");
    expect(message).toContain("🪙 Each: **127,000**");
  });
});
