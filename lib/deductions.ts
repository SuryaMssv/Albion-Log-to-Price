import { buildParticipantShares, computeSplit } from "./calculator";
import type { CalculationResult } from "./types";

export interface DeductionsInput {
  repairCost: number;
  sellerTaxPercent: number;
  marketTaxPercent: number;
}

export interface DeductionBreakdown extends DeductionsInput {
  sellerFee: number;
  marketFee: number;
  netValue: number;
}

export const ZERO_DEDUCTIONS: DeductionsInput = {
  repairCost: 0,
  sellerTaxPercent: 0,
  marketTaxPercent: 0,
};

function isZero(deductions: DeductionsInput): boolean {
  return deductions.repairCost === 0 && deductions.sellerTaxPercent === 0 && deductions.marketTaxPercent === 0;
}

/**
 * Gross − repair − seller tax − market tax. Taxes are percentages of gross (the sale
 * price), not of (gross − repair). Net never goes below zero.
 */
export function computeNet(gross: number, deductions: DeductionsInput): DeductionBreakdown {
  const sellerFee = Math.round((gross * deductions.sellerTaxPercent) / 100);
  const marketFee = Math.round((gross * deductions.marketTaxPercent) / 100);
  return {
    repairCost: deductions.repairCost,
    sellerTaxPercent: deductions.sellerTaxPercent,
    marketTaxPercent: deductions.marketTaxPercent,
    sellerFee,
    marketFee,
    netValue: Math.max(0, gross - deductions.repairCost - sellerFee - marketFee),
  };
}

/** True when selling fees or repair actually change the split. */
export function hasDeductions(result: CalculationResult): boolean {
  return result.repairCost > 0 || result.sellerFee > 0 || result.marketFee > 0;
}

/**
 * Re-splits a result on net distributable value. Zero deductions keep the original
 * object when it already splits gross.
 */
export function applyDeductions(
  result: CalculationResult,
  deductions: DeductionsInput = ZERO_DEDUCTIONS,
): CalculationResult {
  if (
    isZero(deductions) &&
    result.repairCost === 0 &&
    result.sellerFee === 0 &&
    result.marketFee === 0 &&
    result.netValue === result.totalValue
  ) {
    return result;
  }

  const breakdown = computeNet(result.totalValue, deductions);
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
