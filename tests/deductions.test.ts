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
    guildTaxPercent: 0,
    premium: true,
    marketSetupPercent: 2.5,
    marketTaxPercent: 4,
    sellerFee: 0,
    guildFee: 0,
    marketSetupFee: 0,
    marketTaxFee: 0,
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
  it("applies premium market setup 2.5% plus market tax 4% (6.5%)", () => {
    expect(computeNet(1_000_000, { repairCost: 0, sellerTaxPercent: 0, guildTaxPercent: 0, premium: true })).toEqual({
      repairCost: 0,
      sellerTaxPercent: 0,
      guildTaxPercent: 0,
      premium: true,
      marketSetupPercent: 2.5,
      marketTaxPercent: 4,
      sellerFee: 0,
      guildFee: 0,
      marketSetupFee: 25_000,
      marketTaxFee: 40_000,
      marketFee: 65_000,
      netValue: 935_000,
    });
  });

  it("applies non-premium market setup 2.5% plus market tax 8% (10.5%)", () => {
    const net = computeNet(1_000_000, { repairCost: 0, sellerTaxPercent: 0, guildTaxPercent: 0, premium: false });
    expect(net.marketSetupPercent).toBe(2.5);
    expect(net.marketTaxPercent).toBe(8);
    expect(net.marketSetupFee).toBe(25_000);
    expect(net.marketTaxFee).toBe(80_000);
    expect(net.marketFee).toBe(105_000);
    expect(net.netValue).toBe(895_000);
  });

  it("subtracts repair, seller buffer tax, and premium market fees from gross", () => {
    // 1,000,000 − 300,000 repair − 4% buffer − 6.5% premium market
    expect(
      computeNet(1_000_000, { repairCost: 300_000, sellerTaxPercent: 4, guildTaxPercent: 0, premium: true }),
    ).toMatchObject({
      sellerFee: 40_000,
      guildFee: 0,
      marketFee: 65_000,
      netValue: 595_000,
    });
  });

  it("subtracts guild tax as a percent of gross", () => {
    expect(
      computeNet(1_000_000, { repairCost: 300_000, sellerTaxPercent: 4, guildTaxPercent: 10, premium: true }),
    ).toMatchObject({
      guildFee: 100_000,
      netValue: 495_000,
    });
  });

  it("charges tax on gross, not on (gross − repair)", () => {
    const withRepair = computeNet(1_000_000, {
      repairCost: 300_000,
      sellerTaxPercent: 10,
      guildTaxPercent: 0,
      premium: true,
    });
    expect(withRepair.sellerFee).toBe(100_000);
    expect(withRepair.marketFee).toBe(65_000);
    expect(withRepair.netValue).toBe(535_000);
  });

  it("floors net at zero when deductions exceed gross", () => {
    expect(
      computeNet(100_000, { repairCost: 300_000, sellerTaxPercent: 0, guildTaxPercent: 0, premium: true }).netValue,
    ).toBe(0);
  });
});

describe("applyDeductions", () => {
  it("splits net after premium market fees", () => {
    const updated = applyDeductions(result(), {
      repairCost: 300_000,
      sellerTaxPercent: 4,
      guildTaxPercent: 0,
      premium: true,
    });
    expect(updated.totalValue).toBe(1_000_000);
    expect(updated.netValue).toBe(595_000);
    expect(updated.share).toBe(119_000);
    expect(updated.remainder).toBe(0);
  });

  it("keeps the original result when deductions are already applied", () => {
    const deducted = applyDeductions(result(), { repairCost: 0, sellerTaxPercent: 0, guildTaxPercent: 0, premium: true });
    expect(applyDeductions(deducted, { repairCost: 0, sellerTaxPercent: 0, guildTaxPercent: 0, premium: true })).toBe(deducted);
  });
});

describe("Discord deductions", () => {
  it("keeps the gross-only summary when no fees are on the result", () => {
    const message = buildDiscordMessage(result());
    expect(message).toContain("💰 Total Value: **1,000,000**");
    expect(message).not.toContain("Repair");
    expect(message).not.toContain("Net Value");
  });

  it("lists repair, seller buffer tax, and premium market fees, then splits net", () => {
    const message = buildDiscordMessage(
      applyDeductions(result(), { repairCost: 300_000, sellerTaxPercent: 4, guildTaxPercent: 10, premium: true }),
    );
    expect(message).toContain("💰 Gross Value: **1,000,000**");
    expect(message).toContain("🔧 Repair: −300,000");
    expect(message).toContain("📉 Seller buffer tax (4%): −40,000");
    expect(message).toContain("📉 Guild tax (10%): −100,000");
    expect(message).toContain("📉 Market setup (2.5%): −25,000");
    expect(message).toContain("📉 Market tax (4%): −40,000");
    expect(message).toContain("💰 Net Value: **495,000**");
    expect(message).toContain("🪙 Each: **99,000**");
  });
});
