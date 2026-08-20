import { buildParticipantShares, computeSplit } from "./calculator";
import type { CalculationResult } from "./types";

export interface DeductionsInput {
  repairCost: number;
  sellerTaxPercent: number;
  guildTaxPercent: number;
  premium: boolean;
}

export interface DeductionBreakdown {
  repairCost: number;
  sellerTaxPercent: number;
  guildTaxPercent: number;
  premium: boolean;
  marketSetupPercent: number;
  marketTaxPercent: number;
  sellerFee: number;
  guildFee: number;
  marketSetupFee: number;
  marketTaxFee: number;
  marketFee: number;
  netValue: number;
}

export const MARKET_SETUP_PERCENT = 2.5;
export const PREMIUM_MARKET_TAX_PERCENT = 4;
export const NON_PREMIUM_MARKET_TAX_PERCENT = 8;

export const ZERO_DEDUCTIONS: DeductionsInput = {
  repairCost: 0,
  sellerTaxPercent: 0,
  guildTaxPercent: 0,
  premium: true,
};

export function marketRates(premium: boolean): { setupPercent: number; taxPercent: number } {
  return {
    setupPercent: MARKET_SETUP_PERCENT,
    taxPercent: premium ? PREMIUM_MARKET_TAX_PERCENT : NON_PREMIUM_MARKET_TAX_PERCENT,
  };
}

/**
 * Gross − repair − seller buffer tax − guild tax − market setup − market tax.
 * Premium: 2.5% + 4% = 6.5%. Non-premium: 2.5% + 8% = 10.5%.
 * Percentages are of gross. Net never goes below zero.
 */
export function computeNet(gross: number, deductions: DeductionsInput): DeductionBreakdown {
  const rates = marketRates(deductions.premium);
  const sellerFee = Math.round((gross * deductions.sellerTaxPercent) / 100);
  const guildFee = Math.round((gross * deductions.guildTaxPercent) / 100);
  const marketSetupFee = Math.round((gross * rates.setupPercent) / 100);
  const marketTaxFee = Math.round((gross * rates.taxPercent) / 100);
  const marketFee = marketSetupFee + marketTaxFee;
  return {
    repairCost: deductions.repairCost,
    sellerTaxPercent: deductions.sellerTaxPercent,
    guildTaxPercent: deductions.guildTaxPercent,
    premium: deductions.premium,
    marketSetupPercent: rates.setupPercent,
    marketTaxPercent: rates.taxPercent,
    sellerFee,
    guildFee,
    marketSetupFee,
    marketTaxFee,
    marketFee,
    netValue: Math.max(0, gross - deductions.repairCost - sellerFee - guildFee - marketFee),
  };
}

/** True when selling fees or repair actually change the split. */
export function hasDeductions(result: CalculationResult): boolean {
  return result.repairCost > 0 || result.sellerFee > 0 || result.guildFee > 0 || result.marketFee > 0;
}

function alreadyApplied(result: CalculationResult, breakdown: DeductionBreakdown): boolean {
  return (
    result.repairCost === breakdown.repairCost &&
    result.sellerTaxPercent === breakdown.sellerTaxPercent &&
    result.guildTaxPercent === breakdown.guildTaxPercent &&
    result.premium === breakdown.premium &&
    result.sellerFee === breakdown.sellerFee &&
    result.guildFee === breakdown.guildFee &&
    result.marketSetupFee === breakdown.marketSetupFee &&
    result.marketTaxFee === breakdown.marketTaxFee &&
    result.marketFee === breakdown.marketFee &&
    result.netValue === breakdown.netValue
  );
}

/**
 * Re-splits a result on net distributable value. Returns the same object when the
 * requested deductions are already applied.
 */
export function applyDeductions(
  result: CalculationResult,
  deductions: DeductionsInput = ZERO_DEDUCTIONS,
): CalculationResult {
  const breakdown = computeNet(result.totalValue, deductions);
  if (alreadyApplied(result, breakdown)) return result;

  const { share, remainder } = computeSplit(breakdown.netValue, result.participants);

  return {
    ...result,
    ...breakdown,
    share,
    remainder,
    participantShares: buildParticipantShares(
      result.participants,
      share,
      result.participantShares.map((participant) => participant.name),
    ),
  };
}
