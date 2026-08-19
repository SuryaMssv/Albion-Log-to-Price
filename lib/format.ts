/** Whole-silver display formatting, grouped for readability. */
export function formatSilver(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

/** Compact form for headline figures: 4,823,450 -> "4.82M". */
export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return formatSilver(value);
}

/** Age of a price observation, in hours. Returns Infinity if it cannot be parsed. */
export function ageInHours(isoDate: string, now: number = Date.now()): number {
  const parsed = Date.parse(isoDate.endsWith("Z") ? isoDate : `${isoDate}Z`);
  if (!Number.isFinite(parsed)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now - parsed) / 3_600_000);
}

/** "2026-08-18T05:30:00" -> "3h ago". */
export function formatAge(isoDate: string, now: number = Date.now()): string {
  const parsed = Date.parse(isoDate.endsWith("Z") ? isoDate : `${isoDate}Z`);
  if (!Number.isFinite(parsed)) return "unknown";
  const minutes = Math.max(0, Math.round((now - parsed) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function enchantmentLabel(enchantment: number): string {
  return enchantment > 0 ? `.${enchantment}` : "-";
}

/** 4 -> "4", 2.5 -> "2.5" */
export function formatPercent(value: number): string {
  return Number.parseFloat(value.toPrecision(12)).toString();
}
