export const MAX_PARTICIPANTS = 100;
export const MAX_REPAIR_COST = 1_000_000_000_000;
export const MAX_TAX_PERCENT = 100;

export function parseSilverField(raw: string): number {
  if (raw.trim() === "") return 0;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(MAX_REPAIR_COST, Math.trunc(value));
}

export function parsePercentField(raw: string): number {
  if (raw.trim() === "" || raw === ".") return 0;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(MAX_TAX_PERCENT, value);
}

export function isSilverDraft(raw: string): boolean {
  return raw === "" || /^\d+$/.test(raw);
}

export function isPercentDraft(raw: string): boolean {
  if (raw === "" || raw === ".") return true;
  if (!/^\d{0,3}(\.\d{0,4})?$/.test(raw)) return false;
  const value = Number(raw);
  return Number.isFinite(value) && value <= MAX_TAX_PERCENT;
}

export function parseParticipantsField(raw: string): number {
  if (raw.trim() === "") return 0;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1) return 0;
  return Math.min(MAX_PARTICIPANTS, Math.trunc(value));
}

export function isParticipantDraft(raw: string): boolean {
  if (raw === "") return true;
  if (!/^\d+$/.test(raw)) return false;
  const value = Number(raw);
  return value <= MAX_PARTICIPANTS;
}
