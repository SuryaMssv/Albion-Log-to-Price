"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import LogInput from "./LogInput";
import ResultsPanel from "./ResultsPanel";
import JsonUploadButton from "./JsonUploadButton";
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
import { newHistoryId, runDraftsFromInputs, snapshotFromResult, type ChestLogRunInputs, type HistoryEntry } from "@/lib/history";
import { compareChestRows, clusterRowsIntoRuns, isRunGapMinutes, parseChestLog, RUN_GAP_OPTIONS, runGapMs, type RunGapMinutes } from "@/lib/parser";
import { runHeading } from "@/lib/discord";
import { applyManualPrices } from "@/lib/overrides";
import {
  layoutFromRuns,
  lineGroupsForCalculate,
  moveStack,
  reorderStack,
  runCount,
  tableItemsForRun,
  toggleStackExcluded,
  type RunLayout,
} from "@/lib/runs";
import ItemTable from "./ItemTable";
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

const emptyRunDraft = (): ChestLogRunInputs => ({
  participants: "",
  useNames: true,
  names: [],
});

const nameFieldClass =
  "h-6 w-full max-w-44 rounded-sm border border-border-soft bg-surface-raised px-1.5 text-xs leading-none text-foreground outline-none placeholder:text-muted/50 focus:ring-2 focus:ring-gold/40";

const fieldClass =
  "min-h-8 rounded-md border border-border-soft bg-surface-raised px-2.5 text-sm tabular-nums text-foreground outline-none placeholder:text-muted/50 focus:ring-2 focus:ring-gold/40";

export default function LootCalculator() {
  const { upsert, registerRestore, open } = useHistory();
  const [log, setLog] = useState("");
  const [server, setServer] = useState<ServerId>("east");
  const [city, setCity] = useState<City | "">("");
  const [priceBasis, setPriceBasis] = useState<PriceBasis>("sell_mid");
  const [runGapMinutes, setRunGapMinutes] = useState<RunGapMinutes>(10);
  const [runDrafts, setRunDrafts] = useState<ChestLogRunInputs[]>([]);
  const [repairCost, setRepairCost] = useState("");
  const [sellerTax, setSellerTax] = useState("");
  const [guildTax, setGuildTax] = useState("");
  const [premium, setPremium] = useState(true);
  const [result, setResult] = useState<CalculationResult | null>(null);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [layoutOverride, setLayoutOverride] = useState<RunLayout | null>(null);
  const [layoutLog, setLayoutLog] = useState<string | null>(null);
  const [layoutGap, setLayoutGap] = useState<RunGapMinutes | null>(null);
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
      setRunGapMinutes(isRunGapMinutes(entry.inputs.runGapMinutes) ? entry.inputs.runGapMinutes : 10);
      setRunDrafts(runDraftsFromInputs(entry.inputs));
      setRepairCost(entry.inputs.repairCost);
      setSellerTax(entry.inputs.sellerTax);
      setGuildTax(entry.inputs.guildTax);
      setPremium(entry.inputs.premium);
      setResult(entry.result);
      setOverrides(entry.overrides);
      setError(null);
      setLayoutOverride(null);
      setLayoutLog(null);
      setLayoutGap(null);
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
  const parsedRows = useMemo(() => parseChestLog(log).rows, [log]);
  const clustered = useMemo(
    () => clusterRowsIntoRuns(parsedRows, runGapMs(runGapMinutes)),
    [parsedRows, runGapMinutes],
  );
  const defaultLayout = useMemo(() => layoutFromRuns(clustered), [clustered]);
  const layout =
    layoutLog === log && layoutGap === runGapMinutes && layoutOverride ? layoutOverride : defaultLayout;

  function setLayout(next: RunLayout | ((previous: RunLayout) => RunLayout)) {
    setLayoutLog(log);
    setLayoutGap(runGapMinutes);
    setLayoutOverride((previous) => {
      const current =
        layoutLog === log && layoutGap === runGapMinutes && previous ? previous : defaultLayout;
      return typeof next === "function" ? next(current) : next;
    });
  }

  function draftAt(index: number): ChestLogRunInputs {
    return runDrafts[index] ?? emptyRunDraft();
  }

  function alignedDrafts(): ChestLogRunInputs[] {
    return clustered.map((_, index) => draftAt(index));
  }

  function patchRun(index: number, patch: Partial<ChestLogRunInputs>) {
    setRunDrafts((previous) => {
      const count = Math.max(clustered.length, index + 1, previous.length);
      const next = Array.from({ length: count }, (_, i) => previous[i] ?? emptyRunDraft());
      next[index] = { ...next[index], ...patch };
      return next;
    });
  }

  const persist = useCallback(
    (payload: CalculationResult, currentOverrides: Record<string, number>, asNew: boolean) => {
      if (city === "") return;
      if (asNew || !entryIdRef.current) entryIdRef.current = newHistoryId();
      lastLogRef.current = log;
      const displayed = applyDeductions(applyManualPrices(payload, currentOverrides), deductions);
      const drafts = alignedDrafts();
      const first = drafts[0] ?? emptyRunDraft();
      upsert({
        id: entryIdRef.current,
        savedAt: new Date().toISOString(),
        source: "chest-log",
        inputs: {
          log,
          server,
          city,
          priceBasis,
          runGapMinutes,
          participants: first.participants,
          useNames: first.useNames,
          names: first.names,
          runs: drafts,
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
      clustered,
      runDrafts,
      premium,
      priceBasis,
      runGapMinutes,
      repairCost,
      sellerTax,
      server,
      upsert,
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
    if (clustered.length === 0) {
      setError("Could not find any loot rows in that log.");
      return;
    }
    const drafts = Array.from({ length: Math.max(runCount(layout), clustered.length) }, (_, index) =>
      draftAt(index),
    );
    const invalid = drafts.findIndex((draft) => parseParticipantsField(draft.participants) < 1);
    if (invalid !== -1) {
      setError(`Enter how many participants split run ${invalid + 1}.`);
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
          participants: parseParticipantsField(drafts[0]?.participants ?? ""),
          repair_cost: deductions.repairCost,
          seller_tax: deductions.sellerTaxPercent,
          guild_tax: deductions.guildTaxPercent,
          premium: deductions.premium,
          run_lines: lineGroupsForCalculate(parsedRows, layout),
          runs: drafts.map((draft) => {
            const count = parseParticipantsField(draft.participants);
            return {
              participants: count,
              participant_names: draft.names.slice(0, count),
            };
          }),
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
  }, [log, server, city, priceBasis, clustered, runDrafts, deductions, persist, overrides, parsedRows, layout]);

  function clearAll() {
    setLog("");
    setResult(null);
    setError(null);
    setRepairCost("");
    setSellerTax("");
    setGuildTax("");
    setPremium(true);
    setOverrides({});
    setRunDrafts([]);
    setLayoutOverride(null);
    setLayoutLog(null);
    setLayoutGap(null);
    setRunGapMinutes(10);
    entryIdRef.current = null;
    lastLogRef.current = "";
  }

  function updateOverride(key: string, value: number | null) {
    setOverrides((previous) => {
      const next = { ...previous };
      if (value === null) delete next[key];
      else next[key] = value;
      return next;
    });
  }

  function importJson(entry: HistoryEntry) {
    setError(null);
    upsert(entry);
    open(entry);
  }

  function exportJson() {
    if (!result || city === "") return;
    persist(result, overrides, false);
    const displayed = applyDeductions(applyManualPrices(result, overrides), deductions);
    const drafts = alignedDrafts();
    const first = drafts[0] ?? emptyRunDraft();
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
          runGapMinutes,
          participants: first.participants,
          useNames: first.useNames,
          names: first.names,
          runs: drafts,
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
    <div className="flex flex-col gap-4">
      <section className="rounded-xl border border-border-soft bg-surface/60 p-3">
        <LogInput
          value={log}
          onChange={setLog}
          disabled={busy}
          extraActions={<JsonUploadButton onLoaded={importJson} onError={setError} disabled={busy} />}
        />

        <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted">Server</span>
            <select
              value={server}
              onChange={(event) => setServer(event.target.value as ServerId)}
              className={fieldClass}
            >
              {Object.entries(SERVERS).map(([id, meta]) => (
                <option key={id} value={id}>
                  {meta.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted">
              City <span className="text-gold">*</span>
            </span>
            <select
              required
              value={city}
              onChange={(event) => setCity(event.target.value as City | "")}
              aria-invalid={city === ""}
              className={`${fieldClass} ${
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

          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted">Price basis</span>
            <select
              value={priceBasis}
              onChange={(event) => setPriceBasis(event.target.value as PriceBasis)}
              className={fieldClass}
            >
              {Object.entries(PRICE_BASES).map(([id, meta]) => (
                <option key={id} value={id}>
                  {meta.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted">Group runs</span>
            <select
              value={runGapMinutes}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (isRunGapMinutes(value)) setRunGapMinutes(value);
              }}
              className={fieldClass}
            >
              {RUN_GAP_OPTIONS.map((option) => (
                <option key={option.minutes} value={option.minutes}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1 text-xs">
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
              className={fieldClass}
            />
          </label>

          <label className="flex flex-col gap-1 text-xs">
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
                className={`${fieldClass} w-full pr-7`}
              />
              <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-muted">
                %
              </span>
            </div>
          </label>

          <label className="flex flex-col gap-1 text-xs">
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
                className={`${fieldClass} w-full pr-7`}
              />
              <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-muted">
                %
              </span>
            </div>
          </label>

          <fieldset className="flex flex-col gap-1 text-xs">
            <legend className="text-muted">Sellers Account</legend>
            <div className="grid grid-cols-2 gap-0.5 rounded-md border border-border-soft bg-surface-raised p-0.5">
              <button
                type="button"
                aria-pressed={premium}
                onClick={() => setPremium(true)}
                className={`min-h-7 rounded-sm px-2 text-xs font-medium transition-colors ${
                  premium ? "bg-gold text-background" : "text-muted hover:text-foreground"
                }`}
              >
                Premium
              </button>
              <button
                type="button"
                aria-pressed={!premium}
                onClick={() => setPremium(false)}
                className={`min-h-7 rounded-sm px-2 text-xs font-medium transition-colors ${
                  !premium ? "bg-gold text-background" : "text-muted hover:text-foreground"
                }`}
              >
                Non-Premium
              </button>
            </div>
          </fieldset>
        </div>

        <p className="mt-1.5 text-[11px] leading-snug text-muted">
          Repair is silver. Seller buffer and guild tax are optional percents of gross.{" "}
          {PRICE_BASES[priceBasis].hint} Buy orders are never used. Repair is deducted in full from every
          run. Loot more than the group window apart starts a new run.
        </p>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={calculate}
            disabled={busy}
            className="min-h-8 flex-1 rounded-md bg-gold px-4 text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-60 sm:flex-none"
          >
            {busy ? "Calculating…" : result ? "Recalculate" : "Calculate Value"}
          </button>
          <button
            type="button"
            onClick={clearAll}
            disabled={busy}
            className="min-h-8 rounded-md border border-border-soft bg-surface-raised px-3 text-xs font-medium text-foreground transition-colors hover:border-gold-dim disabled:opacity-50"
          >
            Clear
          </button>
        </div>

        {error && (
          <p role="alert" className="mt-2 rounded-md border border-danger/40 bg-danger/5 p-2 text-xs text-danger">
            ❌ {error}
          </p>
        )}

        {runCount(layout) > 0 && (
          <div
            className="mt-3 flex flex-col gap-3"
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => {
              event.preventDefault();
              const raw =
                event.dataTransfer.getData("application/x-ao-stack") ||
                event.dataTransfer.getData("text/plain");
              let payload: { runIndex: number; key: string } | null = null;
              try {
                payload = JSON.parse(raw) as { runIndex: number; key: string };
              } catch {
                payload = null;
              }
              if (!payload) return;
              const hit = document
                .elementFromPoint(event.clientX, event.clientY)
                ?.closest("[data-run-slot]");
              if (!(hit instanceof HTMLElement)) return;
              const toRun = Number(hit.dataset.runSlot);
              if (!Number.isInteger(toRun)) return;
              setLayout((previous) =>
                moveStack(previous, parsedRows, payload.runIndex, toRun, payload.key),
              );
            }}
          >
            {Array.from({ length: runCount(layout) }, (_, index) => {
              const draft = draftAt(index);
              const count = parseParticipantsField(draft.participants);
              const assigned = parsedRows
                .filter((row) => layout.lineRun[row.line] === index)
                .sort(compareChestRows);
              const heading =
                assigned.length === 0
                  ? `Run ${index + 1}`
                  : runHeading({
                      index: index + 1,
                      startedAt: assigned[0].date,
                      endedAt: assigned[assigned.length - 1].date,
                    });
              const tableItems = tableItemsForRun(parsedRows, layout, index, result);
              return (
                <div
                  key={index}
                  data-run-slot={index}
                  className="rounded-md border border-border-soft bg-surface p-1.5"
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const raw =
                      event.dataTransfer.getData("application/x-ao-stack") ||
                      event.dataTransfer.getData("text/plain");
                    let payload: { runIndex: number; key: string } | null = null;
                    try {
                      payload = JSON.parse(raw) as { runIndex: number; key: string };
                    } catch {
                      payload = null;
                    }
                    if (!payload) return;
                    setLayout((previous) =>
                      moveStack(previous, parsedRows, payload.runIndex, index, payload.key),
                    );
                  }}
                >
                  <p className="text-xs font-medium text-foreground">{heading}</p>
                  <div className="mt-1.5 flex flex-col gap-1">
                    <label className="flex max-w-40 flex-col gap-0.5 text-[11px]">
                      <span className="text-muted">Participants</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={draft.participants}
                        onChange={(event) => {
                          const raw = event.target.value.replace(/^0+(?=\d)/, "");
                          if (isParticipantDraft(raw)) patchRun(index, { participants: raw });
                        }}
                        className={nameFieldClass}
                      />
                    </label>
                    {count >= 1 && (
                      <div className="flex max-w-44 flex-col gap-1">
                        {Array.from({ length: count }, (_, nameIndex) => (
                          <input
                            key={nameIndex}
                            type="text"
                            maxLength={40}
                            value={draft.names[nameIndex] ?? ""}
                            onChange={(event) => {
                              const names = [...draft.names];
                              names[nameIndex] = event.target.value;
                              patchRun(index, { names });
                            }}
                            placeholder={`Player ${nameIndex + 1}`}
                            className={nameFieldClass}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="mt-2">
                    <ItemTable
                      items={tableItems}
                      overrides={overrides}
                      onOverrideChange={updateOverride}
                      runIndex={index}
                      onMoveStack={(fromRun, key, toRun, beforeKey) => {
                        setLayout((previous) =>
                          moveStack(previous, parsedRows, fromRun, toRun, key, beforeKey),
                        );
                      }}
                      onReorder={(key, beforeKey) => {
                        setLayout((previous) =>
                          reorderStack(previous, parsedRows, index, key, beforeKey),
                        );
                      }}
                      onToggleExclude={(key) => {
                        setLayout((previous) =>
                          toggleStackExcluded(previous, parsedRows, index, key),
                        );
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div ref={resultsRef}>
        {result && (
          <ResultsPanel
            result={result}
            deductions={deductions}
            overrides={overrides}
            onExportJson={exportJson}
            onRetryPrices={calculate}
            busy={busy}
          />
        )}
      </div>
    </div>
  );
}
