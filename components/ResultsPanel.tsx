"use client";

import { useMemo, useState } from "react";
import ItemTable from "./ItemTable";
import IssuesPanel from "./IssuesPanel";
import { applyDeductions, type DeductionsInput } from "@/lib/deductions";
import { applyManualPrices } from "@/lib/overrides";
import { buildDiscordMessage } from "@/lib/discord";
import { buildCsv } from "@/lib/csv";
import { formatCompact, formatPercent, formatSilver } from "@/lib/format";
import { PRICE_BASES, SERVERS, type CalculationResult } from "@/lib/types";

interface ResultsPanelProps {
  result: CalculationResult;
  deductions: DeductionsInput;
  onRetryPrices: () => void;
  busy: boolean;
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border-soft bg-surface p-4 sm:p-5">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-gold sm:text-3xl">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
    </div>
  );
}

export default function ResultsPanel({
  result: rawResult,
  deductions,
  onRetryPrices,
  busy,
}: ResultsPanelProps) {
  const [copied, setCopied] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, number>>({});

  // Manual prices then deductions: both are pure, so tax/repair edits do not refetch.
  const result = useMemo(
    () => applyDeductions(applyManualPrices(rawResult, overrides), deductions),
    [rawResult, overrides, deductions],
  );

  function updateOverride(key: string, value: number | null) {
    setOverrides((previous) => {
      const next = { ...previous };
      if (value === null) delete next[key];
      else next[key] = value;
      return next;
    });
  }

  async function copyDiscord() {
    const message = buildDiscordMessage(result);
    try {
      await navigator.clipboard.writeText(message);
    } catch {
      // Clipboard API is unavailable (insecure context / older mobile browser).
      const area = document.createElement("textarea");
      area.value = message;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function exportCsv() {
    const blob = new Blob([buildCsv(result)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `albion-loot-${result.stats.calculatedAt.slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const excluded = result.unresolvedItems.length + result.missingPrices.length;
  const manualCount = result.items.filter((item) => item.source === "manual").length;
  const saleCount = result.items.filter((item) => item.source === "recent_sale").length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-foreground">⚔️ Gank Loot</h2>
          <p className="text-xs text-muted">
            Price basis: {SERVERS[result.server].short} — {result.city}{" "}
            {PRICE_BASES[result.priceBasis].short}
          </p>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <StatCard
            label="💰 Gross Market Value"
            value={`${formatSilver(result.totalValue)}`}
            sub={`${formatCompact(result.totalValue)} silver across ${result.stats.itemsPriced} item stacks in ${result.city}`}
          />
          <StatCard
            label="💰 Net Distributable"
            value={`${formatSilver(result.netValue)}`}
            sub={netBreakdown(result)}
          />
          <StatCard
            label="🪙 Each Player"
            value={`${formatSilver(result.share)}`}
            sub={
              result.remainder > 0
                ? `${formatSilver(result.remainder)} silver remainder`
                : "Divides evenly"
            }
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={copyDiscord}
          className="min-h-11 flex-1 rounded-lg bg-gold px-5 text-sm font-semibold text-background transition-opacity hover:opacity-90 sm:flex-none"
        >
          {copied ? "Copied ✓" : "Copy Discord Result"}
        </button>
        <button
          type="button"
          onClick={exportCsv}
          className="min-h-11 flex-1 rounded-lg border border-border-soft bg-surface-raised px-5 text-sm font-medium text-foreground transition-colors hover:border-gold-dim sm:flex-none"
        >
          Export CSV
        </button>
      </div>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-foreground">Participant shares</h3>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {result.participantShares.map((participant, index) => (
            <li
              key={index}
              className="flex items-center justify-between rounded-lg border border-border-soft bg-surface px-4 py-3 text-sm"
            >
              <span className="truncate text-foreground">{participant.name}</span>
              <span className="ml-3 shrink-0 tabular-nums text-gold">
                {formatSilver(participant.share)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">Item breakdown</h3>
          <p className="text-xs text-muted">
            {result.stats.rowsParsed} rows → {result.stats.stacks} stacks
            {saleCount > 0 && ` · ${saleCount} from recent sales`}
            {manualCount > 0 && ` · ${manualCount} manual`}
            {excluded > 0 && ` · ${excluded} excluded`} · market lookup {result.stats.marketMs} ms
          </p>
        </div>
        <ItemTable
          items={result.items}
          overrides={overrides}
          onOverrideChange={updateOverride}
        />
      </section>

      <IssuesPanel
        result={result}
        onRetryPrices={onRetryPrices}
        busy={busy}
        overrides={overrides}
        onOverrideChange={updateOverride}
      />

      <p className="text-xs text-muted">
        Net is gross minus repair, seller buffer tax, market setup and market tax.
      </p>
    </div>
  );
}

function netBreakdown(result: CalculationResult): string {
  const parts: string[] = [];
  if (result.repairCost > 0) parts.push(`−${formatSilver(result.repairCost)} repair`);
  if (result.sellerFee > 0) {
    parts.push(
      `−${formatPercent(result.sellerTaxPercent)}% seller buffer (${formatSilver(result.sellerFee)})`,
    );
  }
  if (result.marketFee > 0) {
    const total = result.marketSetupPercent + result.marketTaxPercent;
    parts.push(`−${formatPercent(total)}% market (${formatSilver(result.marketFee)})`);
  }
  if (parts.length === 0) return "No repair or selling fees";
  return parts.join(" · ");
}
