import { PRICE_SOURCES, type CalculationResult } from "./types";

function escapeCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Item breakdown export, including excluded stacks so the sheet stays auditable. */
export function buildCsv(result: CalculationResult): string {
  const rows: (string | number)[][] = [
    ["Item", "Enchantment", "Quality", "Amount", "Unit Price", "Total Value", "Market", "Price Date", "Source", "Status"],
  ];

  for (const item of result.items) {
    rows.push([
      item.name,
      item.enchantment,
      item.quality,
      item.amount,
      item.unitPrice,
      item.totalValue,
      item.city,
      item.priceDate,
      PRICE_SOURCES[item.source].short,
      item.stale ? "Priced (stale)" : "Priced",
    ]);
  }
  for (const item of result.missingPrices) {
    rows.push([item.name, item.enchantment, item.quality, item.amount, "", "", "", "", "", "No market price"]);
  }
  for (const item of result.unresolvedItems) {
    rows.push([item.name, item.enchantment, item.quality, item.amount, "", "", "", "", "", "Unresolved"]);
  }

  return rows.map((row) => row.map(escapeCell).join(",")).join("\n");
}
