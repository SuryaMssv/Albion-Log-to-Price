"use client";

import { buildExportJson, downloadJson } from "@/lib/export";
import { formatCompact, formatSilver } from "@/lib/format";
import { useHistory } from "./HistoryContext";
import type { HistoryEntry } from "@/lib/history";

export default function HistoryPanel() {
  const { entries, open, remove, clear } = useHistory();

  if (entries.length === 0) {
    return (
      <div className="rounded-2xl border border-border-soft bg-surface/60 p-6">
        <h2 className="text-lg font-semibold text-foreground">History</h2>
        <p className="mt-2 text-sm text-muted">
          Splits you calculate on this device show up here — chest logs, taxes, names, and manual
          prices. Nothing is sent to a server.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-foreground">History</h2>
          <p className="mt-1 text-sm text-muted">
            Saved in this browser only. Reopen to tweak taxes or copy Discord again.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (confirm("Clear all saved splits on this browser?")) clear();
          }}
          className="min-h-11 rounded-lg border border-border-soft bg-surface-raised px-4 text-sm font-medium text-foreground hover:border-gold-dim"
        >
          Clear all
        </button>
      </div>

      <ul className="flex flex-col gap-3">
        {entries.map((entry) => (
          <HistoryRow key={entry.id} entry={entry} onOpen={open} onRemove={remove} />
        ))}
      </ul>
    </div>
  );
}

function HistoryRow({
  entry,
  onOpen,
  onRemove,
}: {
  entry: HistoryEntry;
  onOpen: (entry: HistoryEntry) => void;
  onRemove: (id: string) => void;
}) {
  const when = new Date(entry.savedAt);
  const label = Number.isNaN(when.getTime())
    ? entry.savedAt
    : when.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  return (
    <li className="rounded-xl border border-border-soft bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-foreground">
          {entry.source === "chest-log" ? "Chest Log" : "Calculator"} ·{" "}
          {formatCompact(entry.snapshot.totalValue)} gross
        </p>
        <p className="text-xs text-muted">{label}</p>
      </div>
      <p className="mt-1 text-xs text-muted">
        {formatSilver(entry.snapshot.netValue)} net · {formatSilver(entry.snapshot.share)} each ·{" "}
        {entry.snapshot.participantShares.length} players
        {entry.source === "chest-log" && Object.keys(entry.overrides).length > 0
          ? ` · ${Object.keys(entry.overrides).length} manual price${Object.keys(entry.overrides).length === 1 ? "" : "s"}`
          : ""}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onOpen(entry)}
          className="min-h-11 rounded-lg bg-gold px-4 text-sm font-semibold text-background hover:opacity-90"
        >
          Reopen
        </button>
        <button
          type="button"
          onClick={() =>
            downloadJson(`albion-loot-${entry.savedAt.slice(0, 10)}.json`, buildExportJson(entry))
          }
          className="min-h-11 rounded-lg border border-border-soft bg-surface-raised px-4 text-sm font-medium text-foreground hover:border-gold-dim"
        >
          Export JSON
        </button>
        <button
          type="button"
          onClick={() => onRemove(entry.id)}
          className="min-h-11 rounded-lg border border-border-soft bg-surface-raised px-4 text-sm font-medium text-foreground hover:border-gold-dim"
        >
          Delete
        </button>
      </div>
    </li>
  );
}
