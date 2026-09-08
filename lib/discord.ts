import { hasDeductions, type ManualSplit } from "./deductions";
import { formatChestStamp, formatPercent, formatSilver } from "./format";
import { PRICE_BASES, SERVERS, type CalculationResult, type LootRunResult, type ParticipantShare } from "./types";

export interface DiscordSplitSummary {
  totalValue: number;
  netValue: number;
  repairCost: number;
  sellerTaxPercent: number;
  guildTaxPercent: number;
  marketSetupPercent: number;
  marketTaxPercent: number;
  sellerFee: number;
  guildFee: number;
  marketFee: number;
  participants: number;
  share: number;
  remainder: number;
  participantShares: ParticipantShare[];
}

function buildSplitLines(result: DiscordSplitSummary): string[] {
  const lines: string[] = [];

  if (hasDeductions(result)) {
    lines.push(`💰 Gross Value: **${formatSilver(result.totalValue)}**`);
    if (result.repairCost > 0) {
      lines.push(`🔧 Repair: −${formatSilver(result.repairCost)}`);
    }
    if (result.sellerFee > 0) {
      lines.push(
        `📉 Seller buffer tax (${formatPercent(result.sellerTaxPercent)}%): −${formatSilver(result.sellerFee)}`,
      );
    }
    if (result.guildFee > 0) {
      lines.push(
        `📉 Guild tax (${formatPercent(result.guildTaxPercent)}%): −${formatSilver(result.guildFee)}`,
      );
    }
    if (result.marketFee > 0) {
      const total = result.marketSetupPercent + result.marketTaxPercent;
      lines.push(`📉 Market (${formatPercent(total)}%): −${formatSilver(result.marketFee)}`);
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

  return lines;
}

/**
 * Discord-ready summary (FR-17, PRD §22). Deliberately compact: the item breakdown
 * stays in the app, but anything excluded from the total is called out so the split
 * is never quietly wrong.
 */
export function buildDiscordMessage(result: CalculationResult): string {
  const lines: string[] = ["⚔️ **GANK LOOT SPLIT**", ""];
  const runs = result.runs ?? [];

  if (runs.length > 1) {
    lines.push(`💰 Session Gross: **${formatSilver(result.totalValue)}**`);
    lines.push(`💰 Session Net: **${formatSilver(result.netValue)}**`, "");
    for (const run of runs) {
      lines.push(`**${runHeading(run)}**`, "", ...buildSplitLines(run), "");
    }
  } else {
    lines.push(...buildSplitLines(result));
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

export function runHeading(run: Pick<LootRunResult, "index" | "startedAt" | "endedAt">): string {
  const start = formatChestStamp(run.startedAt);
  const end = formatChestStamp(run.endedAt);
  const range = start === end ? start : `${start} – ${end}`;
  return `Run ${run.index} · ${range}`;
}

/** Split summary for typed-in totals — no market city or item notes. */
export function buildManualDiscordMessage(result: ManualSplit | DiscordSplitSummary): string {
  return ["⚔️ **GANK LOOT SPLIT**", "", ...buildSplitLines(result)].join("\n");
}
