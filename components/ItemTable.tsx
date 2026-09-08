"use client";

import { useMemo, useState } from "react";
import { ageInHours, enchantmentLabel, formatAge, formatSilver, itemIconUrl } from "@/lib/format";
import { overrideKey } from "@/lib/overrides";
import { PRICE_SOURCES } from "@/lib/types";
import type { RunTableItem } from "@/lib/runs";

type SortKey = "name" | "enchantment" | "quality" | "amount" | "unitPrice" | "totalValue";

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: "name", label: "Item", numeric: false },
  { key: "enchantment", label: "Ench", numeric: true },
  { key: "quality", label: "Qual", numeric: true },
  { key: "amount", label: "Qty", numeric: true },
  { key: "unitPrice", label: "Unit Price", numeric: true },
  { key: "totalValue", label: "Total", numeric: true },
];

const DRAG_TYPE = "application/x-ao-stack";

interface ItemTableProps {
  items: RunTableItem[];
  overrides: Record<string, number>;
  onOverrideChange: (key: string, value: number | null) => void;
  runIndex?: number;
  onMoveStack?: (fromRun: number, key: string, toRun: number, beforeKey: string | null) => void;
  onReorder?: (key: string, beforeKey: string | null) => void;
  onToggleExclude?: (key: string) => void;
}

/** Item-by-item valuation. Parent supplies timestamp/custom order; column clicks re-sort. */
export default function ItemTable({
  items,
  overrides,
  onOverrideChange,
  runIndex,
  onMoveStack,
  onReorder,
  onToggleExclude,
}: ItemTableProps) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [ascending, setAscending] = useState(true);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [maxAgeHours, setMaxAgeHours] = useState(2);
  const [dropKey, setDropKey] = useState<string | null>(null);

  const sorted = useMemo(() => {
    if (!sortKey) return items;
    const copy = [...items];
    copy.sort((a, b) => {
      const left = a[sortKey];
      const right = b[sortKey];
      const comparison =
        typeof left === "string" && typeof right === "string"
          ? left.localeCompare(right)
          : Number(left ?? -1) - Number(right ?? -1);
      return ascending ? comparison : -comparison;
    });
    return copy;
  }, [items, sortKey, ascending]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setAscending((previous) => !previous);
    else {
      setSortKey(key);
      setAscending(key === "name");
    }
  }

  const isStale = (item: RunTableItem) =>
    Boolean(item.priceDate) && item.source !== "manual" && ageInHours(item.priceDate!) > maxAgeHours;
  const priced = items.filter((item) => item.unitPrice !== null);
  const staleCount = priced.filter(isStale).length;
  const outlierCount = items.filter((item) => item.spread || item.crossCheck).length;
  const canDrag = onMoveStack !== undefined || onReorder !== undefined;

  function parseDrag(event: React.DragEvent): { runIndex: number; key: string } | null {
    const raw = event.dataTransfer.getData(DRAG_TYPE) || event.dataTransfer.getData("text/plain");
    try {
      const parsed = JSON.parse(raw) as { runIndex: number; key: string };
      if (typeof parsed.runIndex === "number" && typeof parsed.key === "string") return parsed;
    } catch {
      return null;
    }
    return null;
  }

  function handleDrop(event: React.DragEvent, beforeKey: string | null) {
    event.preventDefault();
    event.stopPropagation();
    setDropKey(null);
    const payload = parseDrag(event);
    if (!payload || runIndex === undefined) return;
    if (payload.runIndex === runIndex) onReorder?.(payload.key, beforeKey);
    else onMoveStack?.(payload.runIndex, payload.key, runIndex, beforeKey);
    setSortKey(null);
  }

  if (items.length === 0) {
    return (
      <div
        onDragOver={(event) => {
          if (!canDrag) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }}
        onDrop={(event) => handleDrop(event, null)}
        className="rounded-md border border-dashed border-border-soft bg-surface px-3 py-4 text-center text-[11px] text-muted"
      >
        Drop items here
      </div>
    );
  }

  return (
    <>
      {(outlierCount > 0 || staleCount > 0) && (
        <div className="mb-1.5 flex flex-wrap items-center justify-end gap-2 text-[11px] text-muted">
          <label className="flex items-center gap-1.5">
            Flag older than
            <select
              value={maxAgeHours}
              onChange={(event) => setMaxAgeHours(Number(event.target.value))}
              className="min-h-6 rounded-sm border border-border-soft bg-surface-raised px-1 text-foreground outline-none"
            >
              <option value={1}>1h</option>
              <option value={2}>2h</option>
              <option value={6}>6h</option>
              <option value={24}>24h</option>
            </select>
          </label>
        </div>
      )}

      {outlierCount > 0 && (
        <p className="mb-1.5 text-[11px] text-muted">
          ⚖ {outlierCount} price{outlierCount === 1 ? " sits" : "s sit"} away from other evidence.
          Type over a price to correct it.
        </p>
      )}

      {staleCount > 0 && (
        <p className="mb-1.5 text-[11px] text-warn">
          ⚠ {staleCount} of {priced.length} {staleCount === 1 ? "price is" : "prices are"} older than{" "}
          {maxAgeHours}h.
        </p>
      )}

      <div className="table-scroll rounded-md border border-border-soft bg-surface">
        <table className="item-table w-full min-w-[40rem] border-collapse text-[11px] leading-none">
          <thead>
            <tr className="border-b border-border-soft text-[10px] uppercase tracking-wide text-muted">
              {canDrag && <th className="w-12 px-1 py-0" aria-label="Move" />}
              {COLUMNS.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={
                    sortKey === column.key ? (ascending ? "ascending" : "descending") : "none"
                  }
                  className={`px-1 py-0 font-medium ${column.numeric ? "text-right" : "text-left"}`}
                >
                  <button type="button" onClick={() => toggleSort(column.key)} className="hover:text-gold">
                    {column.label}
                    {sortKey === column.key && <span aria-hidden>{ascending ? " ▲" : " ▼"}</span>}
                  </button>
                </th>
              ))}
              <th scope="col" className="px-1 py-0 text-left font-medium">
                Price Source
              </th>
              {onToggleExclude && <th className="w-8 px-1 py-0" aria-label="Disable" />}
            </tr>
          </thead>
          <tbody>
            {sorted.map((item, index) => {
              const priceKey = item.itemId ? overrideKey({ itemId: item.itemId, quality: item.quality }) : item.key;
              const override = overrides[priceKey];
              const unit = override !== undefined ? override : item.unitPrice;
              const total =
                unit === null || unit === undefined ? null : Math.round(unit) * item.amount;
              const priceIssue =
                Boolean(item.priceIssue) && (unit === null || unit === undefined) && !item.excluded;
              return (
                <tr
                  key={item.key}
                  title={priceIssue ? item.priceIssue : undefined}
                  draggable={canDrag && !item.excluded}
                  onDragStart={(event) => {
                    const payload = JSON.stringify({ runIndex, key: item.key });
                    event.dataTransfer.setData(DRAG_TYPE, payload);
                    event.dataTransfer.setData("text/plain", payload);
                    event.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(event) => {
                    if (!canDrag) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setDropKey(item.key);
                  }}
                  onDragLeave={() => setDropKey((current) => (current === item.key ? null : current))}
                  onDrop={(event) => handleDrop(event, item.key)}
                  className={`border-b border-border-soft/60 last:border-0 ${
                    item.excluded ? "opacity-40" : ""
                  } ${dropKey === item.key ? "bg-gold/10" : ""} ${priceIssue ? "price-issue" : ""}`}
                >
                  {canDrag && (
                    <td className="px-0.5 py-0 text-center text-muted">
                      <div className="flex flex-nowrap items-center justify-center gap-px">
                        <button
                          type="button"
                          aria-label={`Move ${item.name} up`}
                          disabled={index === 0}
                          onClick={() => {
                            const before = sorted[index - 1]?.key ?? null;
                            if (before) onReorder?.(item.key, before);
                            setSortKey(null);
                          }}
                          className="h-4 w-3 text-[9px] leading-none disabled:opacity-30"
                        >
                          ▲
                        </button>
                        <span aria-hidden className="cursor-grab px-0.5 text-[10px] leading-none">
                          ⋮
                        </span>
                        <button
                          type="button"
                          aria-label={`Move ${item.name} down`}
                          disabled={index === sorted.length - 1}
                          onClick={() => {
                            const after = sorted[index + 2]?.key ?? null;
                            onReorder?.(item.key, after);
                            setSortKey(null);
                          }}
                          className="h-4 w-3 text-[9px] leading-none disabled:opacity-30"
                        >
                          ▼
                        </button>
                      </div>
                    </td>
                  )}
                  <td className="max-w-56 px-1 py-0">
                    <span className="flex min-w-0 items-center gap-1">
                      {item.itemId && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={itemIconUrl(item.itemId, item.quality)}
                          alt=""
                          width={16}
                          height={16}
                          title={item.itemId}
                          className="h-4 w-4 shrink-0 object-contain"
                          onError={(event) => {
                            event.currentTarget.style.visibility = "hidden";
                          }}
                        />
                      )}
                      <span className={`truncate ${item.excluded ? "text-foreground line-through" : "text-foreground"}`}>
                        {item.name}
                      </span>
                    </span>
                  </td>
                  <td className="px-1 py-0 text-right tabular-nums text-muted">
                    {enchantmentLabel(item.enchantment)}
                  </td>
                  <td className="px-1 py-0 text-right tabular-nums text-muted">{item.quality}</td>
                  <td className="px-1 py-0 text-right tabular-nums">{item.amount}</td>
                  <td className="px-1 py-0 text-right">
                    <label>
                      <span className="sr-only">Unit price for {item.name}</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        disabled={item.excluded}
                        value={
                          editingKey === priceKey
                            ? String(unit ?? "")
                            : unit === null || unit === undefined
                              ? ""
                              : formatSilver(unit)
                        }
                        title={item.priceIssue ?? "Market price — type over it, including 0"}
                        onFocus={() => setEditingKey(priceKey)}
                        onBlur={() => setEditingKey(null)}
                        onChange={(event) => {
                          const digits = event.target.value.replace(/[^\d]/g, "");
                          if (digits === "") {
                            onOverrideChange(priceKey, null);
                            return;
                          }
                          const value = Number(digits);
                          onOverrideChange(
                            priceKey,
                            Number.isFinite(value) && value >= 0 ? value : null,
                          );
                        }}
                        className={`h-4 w-16 rounded-sm border bg-transparent px-1 py-0 text-right text-[11px] leading-none tabular-nums outline-none focus:ring-1 focus:ring-gold/40 ${
                          priceIssue
                            ? "border-danger/80 text-foreground"
                            : item.source === "manual" || override !== undefined
                              ? "border-gold/50 text-gold"
                              : "border-transparent text-foreground hover:border-border-soft"
                        }`}
                      />
                    </label>
                  </td>
                  <td className="whitespace-nowrap px-1 py-0 text-right font-medium tabular-nums text-gold">
                    {item.excluded || total === null ? "—" : formatSilver(total)}
                  </td>
                  <td className="whitespace-nowrap px-1 py-0 text-[10px] text-muted">
                    {item.source ? (
                      <>
                        <span
                          className={`rounded px-1 text-[9px] leading-none ${
                            item.source === "sell_order" || item.source === "sell_mid"
                              ? "bg-ok/15 text-ok"
                              : item.source === "manual"
                                ? "bg-gold/15 text-gold"
                                : "bg-warn/15 text-warn"
                          }`}
                        >
                          {PRICE_SOURCES[item.source].short}
                        </span>{" "}
                        {item.source === "global" && item.globalMarkets
                          ? `${item.globalMarkets.length} other market${item.globalMarkets.length === 1 ? "" : "s"}`
                          : item.city}{" "}
                        {item.priceDate && `· ${formatAge(item.priceDate)}`}
                        {item.source === "recent_sale" && item.saleCount ? ` · ${item.saleCount} sold` : ""}
                        {isStale(item) && (
                          <span className="ml-1 rounded bg-warn/15 px-1 text-[9px] text-warn">
                            may be gone
                          </span>
                        )}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  {onToggleExclude && (
                    <td className="px-1 py-0 text-right">
                      <button
                        type="button"
                        onClick={() => onToggleExclude(item.key)}
                        className="h-4 rounded-sm px-1 text-[10px] leading-none text-muted hover:text-danger"
                      >
                        {item.excluded ? "Undo" : "Skip"}
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
