"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import LogInput from "./LogInput";
import ResultsPanel from "./ResultsPanel";
import { useHistory } from "./HistoryContext";
import { applyDeductions } from "@/lib/deductions";
import { buildExportJson, downloadJson } from "@/lib/export";
import {
  isParticipantDraft,
  isPercentDraft,
  isSilverDraft,
  MAX_REPAIR_COST,
  parseParticipantsField,
  parsePercentField,
  parseSilverField,
} from "@/lib/fields";
import { newHistoryId, snapshotFromResult } from "@/lib/history";
import { applyManualPrices } from "@/lib/overrides";
import {
  CITIES,
  PRICE_BASES,
  SERVERS,
  type CalculationResult,
  type City,
  type PriceBasis,
  type ServerId,
} from "@/lib/types";

const SAVE_DEBOUNCE_MS = 500;

export default function LootCalculator() {
  const { upsert, registerRestore } = useHistory();
  const [log, setLog] = useState("");
  const [server, setServer] = useState<ServerId>("east");
  const [city, setCity] = useState<City | "">("");
  const [priceBasis, setPriceBasis] = useState<PriceBasis>("sell_mid");
  const [participants, setParticipants] = useState("5");
  const [repairCost, setRepairCost] = useState("");
  const [sellerTax, setSellerTax] = useState("");
  const [guildTax, setGuildTax] = useState("");
  const [premium, setPremium] = useState(true);
  const [useNames, setUseNames] = useState(false);
  const [names, setNames] = useState<string[]>([]);
  const [result, setResult] = useState<CalculationResult | null>(null);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);
  const entryIdRef = useRef<string | null>(null);
  const lastLogRef = useRef("");
  const skipNextSave = useRef(false);

  useEffect(() => {
    return registerRestore((entry) => {
      if (entry.source !== "chest-log") return;
      skipNextSave.current = true;
      setLog(entry.inputs.log);
      setServer(entry.inputs.server);
      setCity(entry.inputs.city);
      setPriceBasis(entry.inputs.priceBasis);
      setParticipants(entry.inputs.participants);
      setRepairCost(entry.inputs.repairCost);
      setSellerTax(entry.inputs.sellerTax);
      setGuildTax(entry.inputs.guildTax);
      setPremium(entry.inputs.premium);
      setUseNames(entry.inputs.useNames);
      setNames(entry.inputs.names);
      setResult(entry.result);
      setOverrides(entry.overrides);
      setError(null);
      entryIdRef.current = entry.id;
      lastLogRef.current = entry.inputs.log;
    });
  }, [registerRestore]);

  const deductions = useMemo(
    () => ({
      repairCost: parseSilverField(repairCost),
      sellerTaxPercent: parsePercentField(sellerTax),
      guildTaxPercent: parsePercentField(guildTax),
      premium,
    }),
    [repairCost, sellerTax, guildTax, premium],
  );
  const participantCount = parseParticipantsField(participants);

  const persist = useCallback(
    (payload: CalculationResult, currentOverrides: Record<string, number>, asNew: boolean) => {
      if (city === "") return;
      if (asNew || !entryIdRef.current) entryIdRef.current = newHistoryId();
      lastLogRef.current = log;
      const displayed = applyDeductions(applyManualPrices(payload, currentOverrides), deductions);
      upsert({
        id: entryIdRef.current,
        savedAt: new Date().toISOString(),
        source: "chest-log",
        inputs: {
          log,
          server,
          city,
          priceBasis,
          participants,
          useNames,
          names,
          repairCost,
          sellerTax,
          guildTax,
          premium,
        },
        overrides: currentOverrides,
        result: payload,
        snapshot: snapshotFromResult(displayed),
      });
    },
    [
      city,
      deductions,
      guildTax,
      log,
      names,
      participants,
      premium,
      priceBasis,
      repairCost,
      sellerTax,
      server,
      upsert,
      useNames,
    ],
  );

  useEffect(() => {
    if (!result || !entryIdRef.current || city === "") return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    const timer = window.setTimeout(() => persist(result, overrides, false), SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [result, overrides, persist, city]);

  const calculate = useCallback(async () => {
    if (log.trim() === "") {
      setError("Paste or upload a chest log first.");
      return;
    }
    if (city === "") {
      setError("Select the city to price the loot against.");
      return;
    }
    if (participantCount < 1) {
      setError("Enter how many participants split the loot.");
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
          participants: participantCount,
          repair_cost: deductions.repairCost,
          seller_tax: deductions.sellerTaxPercent,
          guild_tax: deductions.guildTaxPercent,
          premium: deductions.premium,
          participant_names: useNames ? names.slice(0, participantCount) : [],
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.error ?? "Calculation failed. Please try again.");
        setResult(null);
        return;
      }
      const next = payload as CalculationResult;
      setResult(next);
      persist(next, overrides, !entryIdRef.current || lastLogRef.current !== log);
      requestAnimationFrame(() => {
        resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch {
      setError("Could not reach the calculator. Check your connection and retry.");
      setResult(null);
    } finally {
      setBusy(false);
    }
  }, [log, server, city, priceBasis, participantCount, deductions, useNames, names, persist, overrides]);

  function clearAll() {
    setLog("");
    setResult(null);
    setError(null);
    setNames([]);
    setRepairCost("");
    setSellerTax("");
    setGuildTax("");
    setPremium(true);
    setOverrides({});
    entryIdRef.current = null;
    lastLogRef.current = "";
  }

  function updateName(index: number, value: string) {
    setNames((previous) => {
      const next = [...previous];
      next[index] = value;
      return next;
    });
  }

  function updateOverride(key: string, value: number | null) {
    setOverrides((previous) => {
      const next = { ...previous };
      if (value === null) delete next[key];
      else next[key] = value;
      return next;
    });
  }

  function exportJson() {
    if (!result || city === "") return;
    persist(result, overrides, false);
    const displayed = applyDeductions(applyManualPrices(result, overrides), deductions);
    downloadJson(
      `albion-loot-${displayed.stats.calculatedAt.slice(0, 10)}.json`,
      buildExportJson({
        id: entryIdRef.current ?? newHistoryId(),
        savedAt: new Date().toISOString(),
        source: "chest-log",
        inputs: {
          log,
          server,
          city,
          priceBasis,
          participants,
          useNames,
          names,
          repairCost,
          sellerTax,
          guildTax,
          premium,
        },
        overrides,
        result,
        snapshot: snapshotFromResult(displayed),
      }),
    );
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
              type="text"
              inputMode="numeric"
              placeholder="5"
              value={participants}
              onChange={(event) => {
                const raw = event.target.value.replace(/^0+(?=\d)/, "");
                if (isParticipantDraft(raw)) setParticipants(raw);
              }}
              className="min-h-11 rounded-lg border border-border-soft bg-surface-raised px-3 tabular-nums text-foreground outline-none placeholder:text-muted/50 focus:ring-2 focus:ring-gold/40"
            />
          </label>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
            <span className="text-muted">Seller buffer tax</span>
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
            <span className="text-muted">Guild tax</span>
            <div className="relative">
              <input
                type="text"
                inputMode="decimal"
                placeholder="0"
                value={guildTax}
                onChange={(event) => {
                  const raw = event.target.value.replace(/^0+(?=\d)/, "");
                  if (isPercentDraft(raw)) setGuildTax(raw);
                }}
                className="min-h-11 w-full rounded-lg border border-border-soft bg-surface-raised px-3 pr-8 tabular-nums text-foreground outline-none placeholder:text-muted/50 focus:ring-2 focus:ring-gold/40"
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted">
                %
              </span>
            </div>
          </label>

          <fieldset className="flex flex-col gap-1.5 text-sm">
            <legend className="text-muted">Sellers Account</legend>
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-border-soft bg-surface-raised p-1">
              <button
                type="button"
                aria-pressed={premium}
                onClick={() => setPremium(true)}
                className={`min-h-9 rounded-md px-2 text-sm font-medium transition-colors ${
                  premium ? "bg-gold text-background" : "text-muted hover:text-foreground"
                }`}
              >
                Premium
              </button>
              <button
                type="button"
                aria-pressed={!premium}
                onClick={() => setPremium(false)}
                className={`min-h-9 rounded-md px-2 text-sm font-medium transition-colors ${
                  !premium ? "bg-gold text-background" : "text-muted hover:text-foreground"
                }`}
              >
                Non-Premium
              </button>
            </div>
          </fieldset>
        </div>

        <p className="mt-2 text-xs text-muted">
          Repair is silver. Seller buffer tax and guild tax are optional percents of gross.
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
              {Array.from({ length: Math.max(participantCount, 1) }, (_, index) => (
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
            overrides={overrides}
            onOverrideChange={updateOverride}
            onExportJson={exportJson}
            onRetryPrices={calculate}
            busy={busy}
          />
        )}
      </div>
    </div>
  );
}
