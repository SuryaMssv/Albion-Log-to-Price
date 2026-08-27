"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHistory } from "./HistoryContext";
import { computeManualSplit } from "@/lib/deductions";
import { buildManualDiscordMessage } from "@/lib/discord";
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
import { formatCompact, formatNetBreakdown, formatSilver } from "@/lib/format";
import { newHistoryId, snapshotFromResult } from "@/lib/history";

const fieldClass =
  "min-h-11 rounded-lg border border-border-soft bg-surface-raised px-3 tabular-nums text-foreground outline-none placeholder:text-muted/50 focus:ring-2 focus:ring-gold/40";

const SAVE_DEBOUNCE_MS = 500;

export default function ManualCalculator() {
  const { upsert, registerRestore } = useHistory();
  const [gross, setGross] = useState("");
  const [repairCost, setRepairCost] = useState("");
  const [sellerTax, setSellerTax] = useState("");
  const [guildTax, setGuildTax] = useState("");
  const [premium, setPremium] = useState(true);
  const [participants, setParticipants] = useState("5");
  const [useNames, setUseNames] = useState(false);
  const [names, setNames] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const entryIdRef = useRef<string | null>(null);
  const skipNextSave = useRef(false);

  useEffect(() => {
    return registerRestore((entry) => {
      if (entry.source !== "calculator") return;
      skipNextSave.current = true;
      setGross(entry.inputs.gross);
      setRepairCost(entry.inputs.repairCost);
      setSellerTax(entry.inputs.sellerTax);
      setGuildTax(entry.inputs.guildTax);
      setPremium(entry.inputs.premium);
      setParticipants(entry.inputs.participants);
      setUseNames(entry.inputs.useNames);
      setNames(entry.inputs.names);
      entryIdRef.current = entry.id;
    });
  }, [registerRestore]);

  const participantCount = parseParticipantsField(participants);
  const split = useMemo(() => {
    if (participantCount < 1) return null;
    return computeManualSplit({
      gross: parseSilverField(gross),
      repairCost: parseSilverField(repairCost),
      sellerTaxPercent: parsePercentField(sellerTax),
      guildTaxPercent: parsePercentField(guildTax),
      premium,
      participants: participantCount,
      names: useNames ? names : [],
    });
  }, [gross, repairCost, sellerTax, guildTax, premium, participantCount, useNames, names]);

  const persist = useCallback(() => {
    if (!split || parseSilverField(gross) <= 0) return;
    if (!entryIdRef.current) entryIdRef.current = newHistoryId();
    upsert({
      id: entryIdRef.current,
      savedAt: new Date().toISOString(),
      source: "calculator",
      inputs: {
        gross,
        repairCost,
        sellerTax,
        guildTax,
        premium,
        participants,
        useNames,
        names,
      },
      snapshot: snapshotFromResult(split),
    });
  }, [split, gross, repairCost, sellerTax, guildTax, premium, participants, useNames, names, upsert]);

  useEffect(() => {
    if (parseSilverField(gross) <= 0) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    const timer = window.setTimeout(persist, SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [gross, persist]);

  function updateName(index: number, value: string) {
    setNames((previous) => {
      const next = [...previous];
      next[index] = value;
      return next;
    });
  }

  function clearAll() {
    setGross("");
    setRepairCost("");
    setSellerTax("");
    setGuildTax("");
    setPremium(true);
    setParticipants("5");
    setUseNames(false);
    setNames([]);
    setCopied(false);
    entryIdRef.current = null;
  }

  async function copyDiscord() {
    if (!split) return;
    const message = buildManualDiscordMessage(split);
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

  const grossValue = parseSilverField(gross);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">⚔️ Gank Loot</h2>
        <p className="mt-1 text-sm text-muted">
          Type the figures from a Discord split — no chest log needed. Net and each-player shares
          update as you edit.
        </p>
      </div>

      <section className="rounded-2xl border border-border-soft bg-surface/60 p-4 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="flex flex-col gap-1.5 text-sm sm:col-span-2 lg:col-span-1">
            <span className="text-muted">Gross market value</span>
            <input
              type="text"
              inputMode="numeric"
              placeholder="0"
              value={gross}
              onChange={(event) => {
                const raw = event.target.value.replace(/,/g, "").replace(/^0+(?=\d)/, "");
                if (isSilverDraft(raw) && parseSilverField(raw) <= MAX_REPAIR_COST) {
                  setGross(raw);
                }
              }}
              className={fieldClass}
            />
          </label>

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
              className={fieldClass}
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
                className={`${fieldClass} w-full pr-8`}
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
                className={`${fieldClass} w-full pr-8`}
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted">
                %
              </span>
            </div>
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
              className={fieldClass}
            />
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
          Repair is silver. Seller buffer tax and guild tax are optional percents of gross. Market
          is 6.5% premium or 10.5% non-premium.
        </p>

        <div className="mt-4">
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={useNames}
              onChange={(event) => setUseNames(event.target.checked)}
              className="size-4 accent-gold"
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
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="💰 Gross Market Value"
          value={formatSilver(grossValue)}
          sub={
            grossValue > 0
              ? `${formatCompact(grossValue)} silver typed in`
              : "Enter the Discord gross value"
          }
        />
        <StatCard
          label="💰 Net Distributable"
          value={formatSilver(split?.netValue ?? 0)}
          sub={
            participantCount < 1
              ? "Enter how many participants split the loot"
              : split
                ? formatNetBreakdown(split)
                : "No repair or selling fees"
          }
        />
        <StatCard
          label="🪙 Each Player"
          value={formatSilver(split?.share ?? 0)}
          sub={
            split && split.remainder > 0
              ? `${formatSilver(split.remainder)} silver remainder`
              : split
                ? "Divides evenly"
                : "—"
          }
        />
      </div>

      {split && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-foreground">Participant shares</h3>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {split.participantShares.map((participant, index) => (
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
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={copyDiscord}
          disabled={!split}
          className="min-h-11 flex-1 rounded-lg bg-gold px-5 text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-50 sm:flex-none"
        >
          {copied ? "Copied ✓" : "Copy Discord Result"}
        </button>
        <button
          type="button"
          onClick={() => {
            persist();
            if (!split || parseSilverField(gross) <= 0) return;
            downloadJson(
              `albion-loot-${new Date().toISOString().slice(0, 10)}.json`,
              buildExportJson({
                id: entryIdRef.current ?? newHistoryId(),
                savedAt: new Date().toISOString(),
                source: "calculator",
                inputs: {
                  gross,
                  repairCost,
                  sellerTax,
                  guildTax,
                  premium,
                  participants,
                  useNames,
                  names,
                },
                snapshot: snapshotFromResult(split),
              }),
            );
          }}
          disabled={!split || parseSilverField(gross) <= 0}
          className="min-h-11 flex-1 rounded-lg border border-border-soft bg-surface-raised px-5 text-sm font-medium text-foreground transition-colors hover:border-gold-dim disabled:opacity-50 sm:flex-none"
        >
          Export JSON
        </button>
        <button
          type="button"
          onClick={clearAll}
          className="min-h-11 rounded-lg border border-border-soft bg-surface-raised px-5 text-sm font-medium text-foreground transition-colors hover:border-gold-dim"
        >
          Clear
        </button>
      </div>
    </div>
  );
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
