import { computeSplit, buildParticipantShares, itemValue } from "./calculator";
import type { CalculationResult, MissingPriceItem, PricedItem } from "./types";

/** Overrides are keyed the same way market quotes are: `${itemId}|${quality}`. */
export function overrideKey(item: { itemId: string; quality: number }): string {
  return `${item.itemId}|${item.quality}`;
}

function toPricedItem(item: MissingPriceItem, unitPrice: number, city: string, at: string): PricedItem {
  return {
    itemId: item.itemId,
    name: item.name,
    enchantment: item.enchantment,
    quality: item.quality,
    amount: item.amount,
    unitPrice,
    totalValue: itemValue(unitPrice, item.amount),
    city: city as PricedItem["city"],
    priceDate: at,
    stale: false,
    players: item.players,
    source: "manual",
  };
}

function isUsablePrice(value: number | undefined): value is number {
  return Number.isFinite(value) && (value as number) > 0;
}

/**
 * Folds officer-entered prices into a finished result (FR-16, "manual price override").
 *
 * Applies to every row, not just unpriced ones. Market data is a snapshot of the
 * cheapest listing at the last upload, so it can be missing, stale, or a lone outlier
 * that no longer exists — and the officer looking at their own market screen is a
 * better source than any of those. Pure and total-recomputing, so the split, remainder
 * and per-player shares all stay consistent.
 */
export function applyManualPrices(
  result: CalculationResult,
  overrides: Record<string, number>,
  at: string = new Date().toISOString(),
): CalculationResult {
  const applied: PricedItem[] = [];
  const stillMissing: MissingPriceItem[] = [];

  for (const item of result.missingPrices) {
    const unitPrice = overrides[overrideKey(item)];
    if (isUsablePrice(unitPrice)) {
      applied.push(toPricedItem(item, Math.round(unitPrice), result.city, at));
    } else {
      stillMissing.push(item);
    }
  }

  let repricedAny = false;
  const reprised = result.items.map((item) => {
    const unitPrice = overrides[overrideKey(item)];
    if (!isUsablePrice(unitPrice) || Math.round(unitPrice) === item.unitPrice) return item;
    repricedAny = true;
    const rounded = Math.round(unitPrice);
    return {
      ...item,
      unitPrice: rounded,
      totalValue: itemValue(rounded, item.amount),
      source: "manual" as const,
      priceDate: at,
      stale: false,
      saleCount: undefined,
    };
  });

  if (applied.length === 0 && !repricedAny) return result;

  const items = [...reprised, ...applied].sort((a, b) => b.totalValue - a.totalValue);
  const totalValue = items.reduce((sum, item) => sum + item.totalValue, 0);
  const { share, remainder } = computeSplit(totalValue, result.participants);

  return {
    ...result,
    items,
    missingPrices: stillMissing,
    totalValue,
    share,
    remainder,
    participantShares: buildParticipantShares(
      result.participants,
      share,
      result.participantShares.map((participant) => participant.name),
    ),
    stats: { ...result.stats, itemsPriced: items.length },
  };
}
