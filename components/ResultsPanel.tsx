"use client";

import { useMemo, useState } from "react";
import { applyDeductions, type DeductionsInput } from "@/lib/deductions";
import { applyManualPrices } from "@/lib/overrides";
import { buildDiscordMessage } from "@/lib/discord";
import { formatCompact, formatNetBreakdown, formatSilver } from "@/lib/format";
import { PRICE_BASES, SERVERS, type CalculationResult, type ParticipantShare } from "@/lib/types";
import IssuesPanel from "./IssuesPanel";

interface ResultsPanelProps {
  result: CalculationResult;
  deductions: DeductionsInput;
  overrides: Record<string, number>;
  onExportJson: () => void;
  onRetryPrices: () => void;
  busy: boolean;
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border-soft bg-surface p-3">
      <p className="text-[10px] uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums text-gold">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-muted">{sub}</p>}
    </div>
  );
}

export default function ResultsPanel({
  result: rawResult,
  deductions,
  overrides,
  onExportJson,
  onRetryPrices,
  busy,
}: ResultsPanelProps) {
  const [copied, setCopied] = useState(false);

  const result = useMemo(
    () => applyDeductions(applyManualPrices(rawResult, overrides), deductions),
    [rawResult, overrides, deductions],
  );

  async function copyDiscord() {
    const message = buildDiscordMessage(result);
    try {
      await navigator.clipboard.writeText(message);
    } catch {
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

  const runs = result.runs ?? [];
  const excluded = result.unresolvedItems.length + result.missingPrices.length;
  const manualCount = result.items.filter((item) => item.source === "manual").length;
  const saleCount = result.items.filter((item) => item.source === "recent_sale").length;
  const shares = result.participantShares;
  const even =
    shares.length > 0 && shares.every((participant) => participant.share === shares[0].share);
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">⚔️ Gank Loot</h2>
          <p className="text-[11px] text-muted">
            Price basis: {SERVERS[result.server].short} — {result.city}{" "}
            {PRICE_BASES[result.priceBasis].short}
          </p>
        </div>

        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <StatCard
            label="💰 Gross Market Value"
            value={`${formatSilver(result.totalValue)}`}
            sub={`${formatCompact(result.totalValue)} silver across ${result.stats.itemsPriced} item stacks in ${result.city}`}
          />
          <StatCard
            label="💰 Net Distributable"
            value={`${formatSilver(result.netValue)}`}
            sub={formatNetBreakdown(result)}
          />
          <StatCard
            label={even ? "🪙 Each Player" : "👥 Players"}
            value={even ? `${formatSilver(result.share)}` : String(shares.length)}
            sub={
              result.remainder > 0
                ? `${formatSilver(result.remainder)} silver remainder`
                : even
                  ? "Divides evenly"
                  : "Named players across every run"
            }
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={copyDiscord}
          className="min-h-8 flex-1 rounded-md bg-gold px-3 text-xs font-semibold text-background transition-opacity hover:opacity-90 sm:flex-none"
        >
          {copied ? "Copied ✓" : "Copy Discord Result"}
        </button>
        <button
          type="button"
          onClick={onExportJson}
          className="min-h-8 flex-1 rounded-md border border-border-soft bg-surface-raised px-3 text-xs font-medium text-foreground transition-colors hover:border-gold-dim sm:flex-none"
        >
          Export JSON
        </button>
      </div>

      <p className="text-[11px] text-muted">
        {result.stats.rowsParsed} rows → {result.stats.stacks} stacks
        {saleCount > 0 && ` · ${saleCount} from recent sales`}
        {manualCount > 0 && ` · ${manualCount} manual`}
        {excluded > 0 && ` · ${excluded} excluded`} · market lookup {result.stats.marketMs} ms
      </p>

      <ShareList shares={shares} />

      <IssuesPanel result={result} onRetryPrices={onRetryPrices} busy={busy} />

      <p className="text-[11px] text-muted">
        Net is gross minus repair, seller buffer tax, guild tax, market setup and market tax.
        {runs.length > 1
          ? " Fees come off the session once. Each run splits among its own names, then the same name is added up."
          : ""}{" "}
        Item tables live with each run above.
      </p>
    </div>
  );
}

function ShareList({ shares }: { shares: ParticipantShare[] }) {
  return (
    <section>
      <h3 className="mb-1.5 text-xs font-semibold text-foreground">Participant shares</h3>
      <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {shares.map((participant, index) => (
          <li
            key={index}
            className="flex items-center justify-between rounded-md border border-border-soft bg-surface px-3 py-1.5 text-xs"
          >
            <span className="truncate text-foreground">{participant.name}</span>
            <span className="ml-3 shrink-0 tabular-nums text-gold">
              {formatSilver(participant.share)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
