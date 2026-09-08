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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

function formatTwelveHour(hour24: number, minute: number): string {
  const period = hour24 >= 12 ? "pm" : "am";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${period}`;
}

/**
 * Chest-log stamps (`MM/DD/YYYY HH:MM:SS`) are UTC.
 * Display: `6/Sep/26 11:52 am [5:22 pm]` — UTC 12-hour, IST in brackets.
 * Seconds are dropped. Unparseable values are returned unchanged.
 */
export function formatChestStamp(raw: string): string {
  const match = raw
    .trim()
    .match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) return raw;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const monthName = MONTHS[month - 1];
  if (!monthName || day < 1 || day > 31) return raw;
  const datePart = `${day}/${monthName}/${String(year).slice(-2)}`;
  if (match[4] === undefined) return datePart;
  const utcHour = Number(match[4]);
  const utcMinute = Number(match[5]);
  const utcClock = formatTwelveHour(utcHour, utcMinute);
  const ist = new Date(Date.UTC(year, month - 1, day, utcHour, utcMinute) + IST_OFFSET_MS);
  const istClock = formatTwelveHour(ist.getUTCHours(), ist.getUTCMinutes());
  return `${datePart} ${utcClock} [${istClock}]`;
}

/** In-game render of this item id at this quality (enchantment lives on the id as `@N`). */
export function itemIconUrl(itemId: string, quality: number): string {
  const clamped = Math.min(5, Math.max(1, Math.round(quality)));
  return `https://render.albiononline.com/v1/item/${itemId}.png?quality=${clamped}`;
}

/** 4 -> "4", 2.5 -> "2.5" */
export function formatPercent(value: number): string {
  return Number.parseFloat(value.toPrecision(12)).toString();
}

/** One-line fee list under Net Distributable. */
export function formatNetBreakdown(result: {
  repairCost: number;
  sellerFee: number;
  sellerTaxPercent: number;
  guildFee: number;
  guildTaxPercent: number;
  marketFee: number;
  marketSetupPercent: number;
  marketTaxPercent: number;
}): string {
  const parts: string[] = [];
  if (result.repairCost > 0) parts.push(`−${formatSilver(result.repairCost)} repair`);
  if (result.sellerFee > 0) {
    parts.push(
      `−${formatPercent(result.sellerTaxPercent)}% seller buffer (${formatSilver(result.sellerFee)})`,
    );
  }
  if (result.guildFee > 0) {
    parts.push(`−${formatPercent(result.guildTaxPercent)}% guild (${formatSilver(result.guildFee)})`);
  }
  if (result.marketFee > 0) {
    const total = result.marketSetupPercent + result.marketTaxPercent;
    parts.push(`−${formatPercent(total)}% market (${formatSilver(result.marketFee)})`);
  }
  if (parts.length === 0) return "No repair or selling fees";
  return parts.join(" · ");
}
