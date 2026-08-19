import { hasDeductions } from "./deductions";
import { formatPercent, formatSilver } from "./format";
import { PRICE_BASES, SERVERS, type CalculationResult } from "./types";

/**
 * Discord-ready summary (FR-17, PRD §22). Deliberately compact: the item breakdown
 * stays in the app, but anything excluded from the total is called out so the split
 * is never quietly wrong.
 */
export function buildDiscordMessage(result: CalculationResult): string {
  const lines: string[] = ["⚔️ **GANK LOOT SPLIT**", ""];

  if (hasDeductions(result)) {
    lines.push(`💰 Gross Value: **${formatSilver(result.totalValue)}**`);
    if (result.repairCost > 0) {
      lines.push(`🔧 Repair: −${formatSilver(result.repairCost)}`);
    }
    if (result.sellerFee > 0) {
      lines.push(
        `📉 Seller's tax (${formatPercent(result.sellerTaxPercent)}%): −${formatSilver(result.sellerFee)}`,
      );
    }
    if (result.marketFee > 0) {
      lines.push(
        `📉 Market tax (${formatPercent(result.marketTaxPercent)}%): −${formatSilver(result.marketFee)}`,
      );
    }
    lines.push(`💰 Net Value: **${formatSilver(result.netValue)}**`);
  } else {
    lines.push(`💰 Total Value: **${formatSilver(result.totalValue)}**`);
  }

  lines.push(
    `👥 Participants: **${result.participants}**`,
    `🪙 Each: **${formatSilver(result.share)}**`,
  );

  if (result.remainder > 0) {
    lines.push(`↩️ Remainder: ${formatSilver(result.remainder)} silver`);
  }

  lines.push("", "**Participants**");
  for (const participant of result.participantShares) {
    lines.push(`• ${participant.name} — ${formatSilver(participant.share)}`);
  }

  const excluded = result.unresolvedItems.length + result.missingPrices.length;
  if (excluded > 0) {
    lines.push(
      "",
      `⚠️ ${excluded} item stack(s) excluded from the total (unresolved or no market price).`,
    );
  }

  // Be explicit when part of the total did not come from a live listing.
  const fromSales = result.items.filter((item) => item.source === "recent_sale").length;
  const manual = result.items.filter((item) => item.source === "manual").length;
  if (fromSales > 0 || manual > 0) {
    const notes = [
      fromSales > 0 ? `${fromSales} from recent sales` : null,
      manual > 0 ? `${manual} manually priced` : null,
    ].filter(Boolean);
    lines.push("", `ℹ️ ${notes.join(", ")}.`);
  }

  lines.push(
    "",
    `📊 Price: ${SERVERS[result.server].short} — ${result.city} ${PRICE_BASES[result.priceBasis].short}`,
  );

  return lines.join("\n");
}
