"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import LogInput from "./LogInput";
import ResultsPanel from "./ResultsPanel";
import {
  CITIES,
  PRICE_BASES,
  SERVERS,
  type CalculationResult,
  type City,
  type PriceBasis,
  type ServerId,
} from "@/lib/types";

const MAX_PARTICIPANTS = 100;
const MAX_REPAIR_COST = 1_000_000_000_000;
const MAX_TAX_PERCENT = 100;

function parseSilverField(raw: string): number {
  if (raw.trim() === "") return 0;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(MAX_REPAIR_COST, Math.trunc(value));
}

function parsePercentField(raw: string): number {
  if (raw.trim() === "" || raw === ".") return 0;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(MAX_TAX_PERCENT, value);
}

function isSilverDraft(raw: string): boolean {
  return raw === "" || /^\d+$/.test(raw);
}

function isPercentDraft(raw: string): boolean {
  if (raw === "" || raw === ".") return true;
  if (!/^\d{0,3}(\.\d{0,4})?$/.test(raw)) return false;
  const value = Number(raw);
  return Number.isFinite(value) && value <= MAX_TAX_PERCENT;
}

export default function LootCalculator() {
  const [log, setLog] = useState("");
  const [server, setServer] = useState<ServerId>("east");
  const [city, setCity] = useState<City | "">("");
  const [priceBasis, setPriceBasis] = useState<PriceBasis>("sell_mid");
  const [participants, setParticipants] = useState(5);
  const [repairCost, setRepairCost] = useState("");
  const [sellerTax, setSellerTax] = useState("");
  const [marketTax, setMarketTax] = useState("");
  const [useNames, setUseNames] = useState(false);
  const [names, setNames] = useState<string[]>([]);
  const [result, setResult] = useState<CalculationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);

  const deductions = useMemo(
    () => ({
      repairCost: parseSilverField(repairCost),
      sellerTaxPercent: parsePercentField(sellerTax),
      marketTaxPercent: parsePercentField(marketTax),
    }),
    [repairCost, sellerTax, marketTax],
  );

  const calculate = useCallback(async () => {
    if (log.trim() === "") {
      setError("Paste or upload a chest log first.");
      return;
    }
    if (city === "") {
      setError("Select the city to price the loot against.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          log,
          server,
          city,
          price_basis: priceBasis,
          participants,
          repair_cost: deductions.repairCost,
          seller_tax: deductions.sellerTaxPercent,
          market_tax: deductions.marketTaxPercent,
          participant_names: useNames ? names.slice(0, participants) : [],
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.error ?? "Calculation failed. Please try again.");
        setResult(null);
        return;
      }
      setResult(payload as CalculationResult);
      requestAnimationFrame(() => {
        resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch {
      setError("Could not reach the calculator. Check your connection and retry.");
      setResult(null);
    } finally {
      setBusy(false);
    }
  }, [log, server, city, priceBasis, participants, deductions, useNames, names]);

  function clearAll() {
    setLog("");
    setResult(null);
    setError(null);
    setNames([]);
    setRepairCost("");
    setSellerTax("");
    setMarketTax("");
  }

  function updateName(index: number, value: string) {
    setNames((previous) => {
      const next = [...previous];
      next[index] = value;
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-2xl border border-border-soft bg-surface/60 p-4 sm:p-6">
        <LogInput value={log} onChange={setLog} disabled={busy} />

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-muted">Server</span>
            <select
              value={server}
              onChange={(event) => setServer(event.target.value as ServerId)}
              className="min-h-11 rounded-lg border border-border-soft bg-surface-raised px-3 text-foreground outline-none focus:ring-2 focus:ring-gold/40"
            >
              {Object.entries(SERVERS).map(([id, meta]) => (
                <option key={id} value={id}>
                  {meta.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-muted">
              City <span className="text-gold">*</span>
            </span>
            <select
              required
              value={city}
              onChange={(event) => setCity(event.target.value as City | "")}
              aria-invalid={city === ""}
              className={`min-h-11 rounded-lg border bg-surface-raised px-3 outline-none focus:ring-2 focus:ring-gold/40 ${
                city === "" ? "border-gold-dim text-muted" : "border-border-soft text-foreground"
              }`}
            >
              <option value="">Select a city…</option>
              {CITIES.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-muted">Price basis</span>
            <select
              value={priceBasis}
              onChange={(event) => setPriceBasis(event.target.value as PriceBasis)}
              className="min-h-11 rounded-lg border border-border-soft bg-surface-raised px-3 text-foreground outline-none focus:ring-2 focus:ring-gold/40"
            >
              {Object.entries(PRICE_BASES).map(([id, meta]) => (
                <option key={id} value={id}>
                  {meta.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-muted">Participants</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_PARTICIPANTS}
              value={participants}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isFinite(value)) {
                  setParticipants(Math.min(MAX_PARTICIPANTS, Math.max(1, Math.trunc(value))));
                }
              }}
              className="min-h-11 rounded-lg border border-border-soft bg-surface-raised px-3 tabular-nums text-foreground outline-none focus:ring-2 focus:ring-gold/40"
            />
          </label>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-muted">Repair cost</span>
            <input
              type="text"
              inputMode="numeric"
              placeholder="0"
              value={repairCost}
              onChange={(event) => {
                const raw = event.target.value.replace(/,/g, "").replace(/^0+(?=\d)/, "");
                if (isSilverDraft(raw) && parseSilverField(raw) <= MAX_REPAIR_COST) {
                  setRepairCost(raw);
                }
              }}
              className="min-h-11 rounded-lg border border-border-soft bg-surface-raised px-3 tabular-nums text-foreground outline-none placeholder:text-muted/50 focus:ring-2 focus:ring-gold/40"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-muted">Seller&apos;s tax</span>
            <div className="relative">
              <input
                type="text"
                inputMode="decimal"
                placeholder="0"
                value={sellerTax}
                onChange={(event) => {
                  const raw = event.target.value.replace(/^0+(?=\d)/, "");
                  if (isPercentDraft(raw)) setSellerTax(raw);
                }}
                className="min-h-11 w-full rounded-lg border border-border-soft bg-surface-raised px-3 pr-8 tabular-nums text-foreground outline-none placeholder:text-muted/50 focus:ring-2 focus:ring-gold/40"
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted">
                %
              </span>
            </div>
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-muted">Market tax</span>
            <div className="relative">
              <input
                type="text"
                inputMode="decimal"
                placeholder="0"
                value={marketTax}
                onChange={(event) => {
                  const raw = event.target.value.replace(/^0+(?=\d)/, "");
                  if (isPercentDraft(raw)) setMarketTax(raw);
                }}
                className="min-h-11 w-full rounded-lg border border-border-soft bg-surface-raised px-3 pr-8 tabular-nums text-foreground outline-none placeholder:text-muted/50 focus:ring-2 focus:ring-gold/40"
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted">
                %
              </span>
            </div>
          </label>
        </div>

        <p className="mt-2 text-xs text-muted">
          Repair is silver. Seller&apos;s tax and market tax are percentages of gross loot — leave
          them at 0% when the loot is not being sold.
        </p>

        <p className="mt-2 text-xs text-muted">
          {PRICE_BASES[priceBasis].hint} Where the basis has no data the other sources fill in,
          labelled per row; anything still unpriced can be entered by hand. Buy orders are never
          used — a standing lowball offer is not what an item is worth.
        </p>

        <div className="mt-4">
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={useNames}
              onChange={(event) => setUseNames(event.target.checked)}
              className="size-4 accent-[var(--gold)]"
            />
            Enter participant names
          </label>

          {useNames && (
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: participants }, (_, index) => (
                <input
                  key={index}
                  type="text"
                  maxLength={40}
                  value={names[index] ?? ""}
                  onChange={(event) => updateName(index, event.target.value)}
                  placeholder={`Player ${index + 1}`}
                  className="min-h-11 rounded-lg border border-border-soft bg-surface-raised px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-gold/40"
                />
              ))}
            </div>
          )}
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={calculate}
            disabled={busy}
            className="min-h-12 flex-1 rounded-lg bg-gold px-6 text-base font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-60 sm:flex-none"
          >
            {busy ? "Calculating…" : result ? "Recalculate" : "Calculate Value"}
          </button>
          <button
            type="button"
            onClick={clearAll}
            disabled={busy}
            className="min-h-12 rounded-lg border border-border-soft bg-surface-raised px-6 text-sm font-medium text-foreground transition-colors hover:border-gold-dim disabled:opacity-50"
          >
            Clear
          </button>
        </div>

        {error && (
          <p role="alert" className="mt-4 rounded-lg border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
            ❌ {error}
          </p>
        )}
      </section>

      <div ref={resultsRef}>
        {result && (
          <ResultsPanel
            result={result}
            deductions={deductions}
            onRetryPrices={calculate}
            busy={busy}
          />
        )}
      </div>
    </div>
  );
}
