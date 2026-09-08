"use client";

import { useState } from "react";
import type { CalculationResult } from "@/lib/types";

interface IssuesPanelProps {
  result: CalculationResult;
  onRetryPrices: () => void;
  busy: boolean;
}

/**
 * Log/market problems that are not item rows. Unpriced stacks stay in the run table.
 */
export default function IssuesPanel({ result, onRetryPrices, busy }: IssuesPanelProps) {
  const [showFailedRows, setShowFailedRows] = useState(false);
  const { parseErrors, warnings } = result;

  if (parseErrors.length === 0 && warnings.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      {warnings.length > 0 && (
        <section className="rounded-xl border border-warn/40 bg-warn/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-warn">⚠ Market lookup warnings</h3>
            <button
              type="button"
              onClick={onRetryPrices}
              disabled={busy}
              className="min-h-8 rounded-md border border-warn/50 px-3 text-xs font-medium text-warn transition-colors hover:bg-warn/10 disabled:opacity-50"
            >
              Retry prices
            </button>
          </div>
          <ul className="mt-2 space-y-1 text-sm text-muted">
            {warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
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
              className="min-h-8 rounded-md border border-danger/50 px-3 text-xs font-medium text-danger transition-colors hover:bg-danger/10"
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
