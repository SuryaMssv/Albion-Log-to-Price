import { describe, expect, it } from "vitest";
import { computeManualSplit } from "@/lib/deductions";
import { buildManualDiscordMessage } from "@/lib/discord";

const gankLoot = {
  gross: 9_421_082,
  repairCost: 685_513,
  sellerTaxPercent: 6,
  guildTaxPercent: 6,
  premium: true,
  participants: 8,
};

describe("computeManualSplit", () => {
  it("applies repair, taxes, and premium market fees then splits net", () => {
    const split = computeManualSplit(gankLoot);

    expect(split.totalValue).toBe(9_421_082);
    expect(split.sellerFee).toBe(565_265);
    expect(split.guildFee).toBe(565_265);
    expect(split.marketFee).toBe(612_370);
    expect(split.netValue).toBe(6_992_669);
    expect(split.share).toBe(874_083);
    expect(split.remainder).toBe(5);
    expect(split.participantShares).toHaveLength(8);
    expect(split.participantShares[0]).toEqual({ name: "Player 1", share: 874_083 });
  });

  it("uses provided participant names", () => {
    const split = computeManualSplit({ ...gankLoot, participants: 2, names: ["Ada", ""] });
    expect(split.participantShares.map((participant) => participant.name)).toEqual(["Ada", "Player 2"]);
  });
});

describe("buildManualDiscordMessage", () => {
  it("lists fees, net, and names without a price-basis line or item notes", () => {
    const message = buildManualDiscordMessage(
      computeManualSplit({ ...gankLoot, names: ["Ada", "Bex"] }),
    );

    expect(message).toContain("💰 Gross Value: **9,421,082**");
    expect(message).toContain("🔧 Repair: −685,513");
    expect(message).toContain("📉 Seller buffer tax (6%): −565,265");
    expect(message).toContain("📉 Guild tax (6%): −565,265");
    expect(message).toContain("📉 Market (6.5%): −612,370");
    expect(message).toContain("💰 Net Value: **6,992,669**");
    expect(message).toContain("👥 Participants: **8**");
    expect(message).toContain("🪙 Each: **874,083**");
    expect(message).toContain("↩️ Remainder: 5 silver");
    expect(message).toContain("• Ada — 874,083");
    expect(message).toContain("• Bex — 874,083");
    expect(message).toContain("• Player 3 — 874,083");
    expect(message).not.toContain("📊 Price:");
    expect(message).not.toContain("excluded");
    expect(message).not.toContain("ℹ️");
  });
});
