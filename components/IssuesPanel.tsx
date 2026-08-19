"use client";

import { useState } from "react";
import { enchantmentLabel } from "@/lib/format";
import { overrideKey } from "@/lib/overrides";
import type { CalculationResult } from "@/lib/types";

interface IssuesPanelProps {
  result: CalculationResult;
  onRetryPrices: () => void;
  busy: boolean;
  overrides: Record<string, number>;
  onOverrideChange: (key: string, value: number | null) => void;
}

/**
 * Everything excluded from the total, shown together so nothing disappears
 * silently (FR-15, FR-16, PRD §13).
 */
export default function IssuesPanel({
  result,
  onRetryPrices,
  busy,
  overrides,
  onOverrideChange,
}: IssuesPanelProps) {
  const [showFailedRows, setShowFailedRows] = useState(false);
  const { unresolvedItems, missingPrices, parseErrors, warnings } = result;

  if (
    unresolvedItems.length === 0 &&
    missingPrices.length === 0 &&
    parseErrors.length === 0 &&
    warnings.length === 0
  ) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4">
      {warnings.length > 0 && (
        <section className="rounded-xl border border-warn/40 bg-warn/5 p-4">
          <h3 className="text-sm font-semibold text-warn">⚠ Market lookup warnings</h3>
          <ul className="mt-2 space-y-1 text-sm text-muted">
            {warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </section>
      )}

      {missingPrices.length > 0 && (
        <section className="rounded-xl border border-warn/40 bg-warn/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-warn">
              ⚠ No price anywhere ({missingPrices.length})
            </h3>
            <button
              type="button"
              onClick={onRetryPrices}
              disabled={busy}
              className="min-h-9 rounded-lg border border-warn/50 px-3 text-xs font-medium text-warn transition-colors hover:bg-warn/10 disabled:opacity-50"
            >
              Retry prices
            </button>
          </div>
          <ul className="mt-3 space-y-3 text-sm text-muted">
            {missingPrices.map((item) => {
              const key = overrideKey(item);
              return (
                <li key={key} className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <span className="text-foreground">{item.name}</span>{" "}
                    <span className="text-xs">
                      (ench {enchantmentLabel(item.enchantment)}, quality {item.quality}) ×{" "}
                      {item.amount}
                    </span>
                    <span className="block text-xs">{item.reason}</span>
                  </div>
                  <label className="flex shrink-0 items-center gap-2">
                    <span className="sr-only">Unit price for {item.name}</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      value={overrides[key] ?? ""}
                      placeholder="Unit price"
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        onOverrideChange(
                          key,
                          event.target.value === "" || !Number.isFinite(value) || value <= 0
                            ? null
                            : value,
                        );
                      }}
                      className="min-h-11 w-36 rounded-lg border border-warn/40 bg-surface-raised px-3 text-right text-sm tabular-nums text-foreground outline-none focus:ring-2 focus:ring-gold/40"
                    />
                  </label>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-muted">
            No listing in {result.city}, no listing in any other market, and no recorded sale. If
            you can see a price in game, type it here and it is added to the total.
          </p>
        </section>
      )}

      {unresolvedItems.length > 0 && (
        <section className="rounded-xl border border-danger/40 bg-danger/5 p-4">
          <h3 className="text-sm font-semibold text-danger">
            ⚠ Unresolved items ({unresolvedItems.length})
          </h3>
          <ul className="mt-2 space-y-2 text-sm text-muted">
            {unresolvedItems.map((item, index) => (
              <li key={index}>
                <span className="text-foreground">{item.name}</span>{" "}
                <span className="text-xs">
                  (ench {enchantmentLabel(item.enchantment)}, quality {item.quality}) × {item.amount}
                </span>
                <span className="block text-xs">{item.reason}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">These items are excluded from the total until resolved.</p>
        </section>
      )}

      {parseErrors.length > 0 && (
        <section className="rounded-xl border border-danger/40 bg-danger/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-danger">
              ⚠ {result.stats.rowsParsed} rows parsed successfully. {parseErrors.length} row(s) could
              not be parsed.
            </h3>
            <button
              type="button"
              onClick={() => setShowFailedRows((previous) => !previous)}
              className="min-h-9 rounded-lg border border-danger/50 px-3 text-xs font-medium text-danger transition-colors hover:bg-danger/10"
            >
              {showFailedRows ? "Hide rows" : "Inspect rows"}
            </button>
          </div>
          {showFailedRows && (
            <ul className="mt-3 space-y-2 text-xs">
              {parseErrors.map((error) => (
                <li key={error.line} className="rounded-lg bg-background/60 p-2">
                  <span className="text-muted">Line {error.line}:</span>{" "}
                  <span className="text-danger">{error.reason}</span>
                  <pre className="mt-1 overflow-x-auto font-mono text-[11px] text-muted">
                    {error.raw}
                  </pre>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
