"use client";

import { useMemo, useState } from "react";
import { ageInHours, enchantmentLabel, formatAge, formatSilver } from "@/lib/format";
import { overrideKey } from "@/lib/overrides";
import { PRICE_SOURCES, type PricedItem } from "@/lib/types";

type SortKey = "name" | "enchantment" | "quality" | "amount" | "unitPrice" | "totalValue";

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: "name", label: "Item", numeric: false },
  { key: "enchantment", label: "Ench", numeric: true },
  { key: "quality", label: "Qual", numeric: true },
  { key: "amount", label: "Qty", numeric: true },
  { key: "unitPrice", label: "Unit Price", numeric: true },
  { key: "totalValue", label: "Total", numeric: true },
];

interface ItemTableProps {
  items: PricedItem[];
  overrides: Record<string, number>;
  onOverrideChange: (key: string, value: number | null) => void;
}

/** Item-by-item valuation, sortable on every column, with correctable prices (FR-13). */
export default function ItemTable({ items, overrides, onOverrideChange }: ItemTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("totalValue");
  const [ascending, setAscending] = useState(false);
  // Money reads better grouped, but a grouped value is painful to edit — so show the
  // raw number only while the field has focus.
  const [editingKey, setEditingKey] = useState<string | null>(null);
  // What counts as "current" depends on how liquid the item is, so it is the officer's call.
  const [maxAgeHours, setMaxAgeHours] = useState(2);

  const sorted = useMemo(() => {
    const copy = [...items];
    copy.sort((a, b) => {
      const left = a[sortKey];
      const right = b[sortKey];
      const comparison =
        typeof left === "string" && typeof right === "string"
          ? left.localeCompare(right)
          : Number(left) - Number(right);
      return ascending ? comparison : -comparison;
    });
    return copy;
  }, [items, sortKey, ascending]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) setAscending((previous) => !previous);
    else {
      setSortKey(key);
      setAscending(key === "name");
    }
  }

  const isStale = (item: PricedItem) =>
    item.source !== "manual" && ageInHours(item.priceDate) > maxAgeHours;
  const staleCount = items.filter(isStale).length;
  const outlierCount = items.filter((item) => item.spread || item.crossCheck).length;

  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-border-soft bg-surface p-4 text-sm text-muted">
        No items could be priced from this log.
      </p>
    );
  }

  return (
    <>
      <div className="mb-2 flex flex-wrap items-center justify-end gap-2 text-xs text-muted">
        <label className="flex items-center gap-2">
          Flag prices older than
          <select
            value={maxAgeHours}
            onChange={(event) => setMaxAgeHours(Number(event.target.value))}
            className="min-h-9 rounded-lg border border-border-soft bg-surface-raised px-2 text-foreground outline-none focus:ring-2 focus:ring-gold/40"
          >
            <option value={1}>1 hour</option>
            <option value={2}>2 hours</option>
            <option value={6}>6 hours</option>
            <option value={24}>24 hours</option>
          </select>
        </label>
      </div>

      {outlierCount > 0 && (
        <p className="mb-2 rounded-lg border border-gold-dim/50 bg-gold/5 p-3 text-xs text-muted">
          ⚖ {outlierCount} price{outlierCount === 1 ? " sits" : "s sit"} well away from the other
          evidence — a wide listing range means one cheap entry is dragging the low end down. The
          comparison figure is shown under each. Switch the price basis, or type over the price.
        </p>
      )}

      {staleCount > 0 && (
        <div className="mb-2 rounded-lg border border-warn/40 bg-warn/5 p-3 text-xs text-warn">
          <p>
            ⚠ {staleCount} of {items.length} price{staleCount === 1 ? " is" : "s are"} older than{" "}
            {maxAgeHours} hour{maxAgeHours === 1 ? "" : "s"}. A lowest sell order is the single
            cheapest listing at the last upload — underpriced ones sell first, so it may already be
            gone.
          </p>
          <p className="mt-2 text-muted">
            Prices only exist where a player ran the{" "}
            <a
              href="https://github.com/ao-data/albiondata-client/releases"
              target="_blank"
              rel="noreferrer"
              className="text-gold hover:underline"
            >
              Albion Data Client
            </a>{" "}
            with that market open. To get live prices: run it, open the {items[0]?.city} market in
            game, then hit Recalculate — uploads appear in the API immediately. Otherwise, check in
            game and type over any price that looks wrong.
          </p>
        </div>
      )}
      <div className="table-scroll rounded-xl border border-border-soft bg-surface">
      <table className="w-full min-w-[46rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border-soft text-xs uppercase tracking-wide text-muted">
            {COLUMNS.map((column) => (
              <th
                key={column.key}
                scope="col"
                aria-sort={
                  sortKey === column.key ? (ascending ? "ascending" : "descending") : "none"
                }
                className={`p-3 font-medium ${column.numeric ? "text-right" : "text-left"}`}
              >
                <button
                  type="button"
                  onClick={() => toggleSort(column.key)}
                  className="min-h-8 hover:text-gold"
                >
                  {column.label}
                  {sortKey === column.key && <span aria-hidden>{ascending ? " ▲" : " ▼"}</span>}
                </button>
              </th>
            ))}
            <th scope="col" className="p-3 text-left font-medium">
              Price Source
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((item) => (
            <tr
              key={`${item.itemId}|${item.quality}`}
              className="border-b border-border-soft/60 last:border-0"
            >
              <td className="p-3">
                <span className="text-foreground">{item.name}</span>
                <span className="ml-2 font-mono text-[11px] text-muted">{item.itemId}</span>
              </td>
              <td className="p-3 text-right tabular-nums text-muted">
                {enchantmentLabel(item.enchantment)}
              </td>
              <td className="p-3 text-right tabular-nums text-muted">{item.quality}</td>
              <td className="p-3 text-right tabular-nums">{item.amount}</td>
              <td className="p-3 text-right">
                <label>
                  <span className="sr-only">Unit price for {item.name}</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={
                      editingKey === overrideKey(item)
                        ? String(overrides[overrideKey(item)] ?? item.unitPrice)
                        : formatSilver(overrides[overrideKey(item)] ?? item.unitPrice)
                    }
                    title="Market price — type over it to use the price you can see in game"
                    onFocus={() => setEditingKey(overrideKey(item))}
                    onBlur={() => setEditingKey(null)}
                    onChange={(event) => {
                      const digits = event.target.value.replace(/[^\d]/g, "");
                      const value = Number(digits);
                      onOverrideChange(
                        overrideKey(item),
                        digits === "" || !Number.isFinite(value) || value <= 0 ? null : value,
                      );
                    }}
                    className={`min-h-9 w-28 rounded-lg border bg-transparent px-2 py-1 text-right text-sm tabular-nums outline-none focus:ring-2 focus:ring-gold/40 ${
                      item.source === "manual"
                        ? "border-gold/50 text-gold"
                        : "border-transparent text-foreground hover:border-border-soft"
                    }`}
                  />
                </label>
              </td>
              <td className="p-3 text-right font-medium tabular-nums text-gold">
                {formatSilver(item.totalValue)}
              </td>
              <td className="p-3 text-xs text-muted">
                <span
                  className={`rounded px-1.5 py-0.5 text-[11px] ${
                    item.source === "sell_order"
                      ? "bg-ok/15 text-ok"
                      : item.source === "sell_mid"
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
                · {formatAge(item.priceDate)}
                {item.source === "recent_sale" && item.saleCount ? ` · ${item.saleCount} sold` : ""}
                {isStale(item) && (
                  <span className="ml-2 rounded bg-warn/15 px-1.5 py-0.5 text-[11px] text-warn">
                    may be gone
                  </span>
                )}
                {item.source === "global" && item.globalMarkets && (
                  <span className="mt-0.5 block text-[11px] text-muted">
                    median of {item.globalMarkets.join(", ")}
                  </span>
                )}
                {(item.spread || item.crossCheck) && (
                  <span className="mt-0.5 block text-[11px] text-warn">
                    {item.spread &&
                      `listings ${formatSilver(item.spread.min)}–${formatSilver(item.spread.max)}`}
                    {item.spread && item.crossCheck ? " · " : ""}
                    {item.crossCheck &&
                      `${item.crossCheck.label} ${formatSilver(item.crossCheck.price)}`}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </>
  );
}
