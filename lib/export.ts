import type { HistoryEntry } from "./history";

export function buildExportJson(entry: HistoryEntry): string {
  return JSON.stringify(entry, null, 2);
}

export function downloadJson(filename: string, json: string): void {
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
