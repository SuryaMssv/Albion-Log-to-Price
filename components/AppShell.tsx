"use client";

import { useCallback, useRef, useState } from "react";
import HistoryPanel from "./HistoryPanel";
import { HistoryProvider } from "./HistoryContext";
import LootCalculator from "./LootCalculator";
import ManualCalculator from "./ManualCalculator";
import type { HistoryEntry } from "@/lib/history";

type AppTab = "chest-log" | "calculator" | "history";

interface AppShellProps {
  itemNames: number;
  generatedAt: string;
}

export default function AppShell({ itemNames, generatedAt }: AppShellProps) {
  const [tab, setTab] = useState<AppTab>("chest-log");
  const mainRef = useRef<HTMLElement>(null);

  function selectTab(next: AppTab) {
    setTab(next);
    mainRef.current?.scrollTo({ top: 0 });
  }

  const handleOpen = useCallback((entry: HistoryEntry) => {
    setTab(entry.source);
    requestAnimationFrame(() => {
      mainRef.current?.scrollTo({ top: 0 });
    });
  }, []);

  return (
    <HistoryProvider onOpen={handleOpen}>
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <header className="shrink-0 border-b border-border-soft bg-background/95 backdrop-blur">
          <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
            <div className="flex items-baseline gap-2 py-2">
              <h1 className="text-base font-bold tracking-tight text-foreground sm:text-lg">
                ⚔️ Albion Guild Loot Calculator
              </h1>
              <p className="text-xs text-gold">by suryamssv</p>
            </div>

            <div
              role="tablist"
              aria-label="Mode"
              className="mb-2 grid grid-cols-3 gap-1 rounded-lg border border-border-soft bg-surface-raised p-1"
            >
              <TabButton
                id="tab-chest-log"
                controls="panel-chest-log"
                selected={tab === "chest-log"}
                onSelect={() => selectTab("chest-log")}
              >
                Chest Log
              </TabButton>
              <TabButton
                id="tab-calculator"
                controls="panel-calculator"
                selected={tab === "calculator"}
                onSelect={() => selectTab("calculator")}
              >
                Calculator
              </TabButton>
              <TabButton
                id="tab-history"
                controls="panel-history"
                selected={tab === "history"}
                onSelect={() => selectTab("history")}
              >
                History
              </TabButton>
            </div>
          </div>
        </header>

        <main
          ref={mainRef}
          className="mx-auto min-h-0 w-full max-w-5xl flex-1 overflow-y-auto overscroll-y-contain px-4 py-5 sm:px-6"
        >
          <div id="panel-chest-log" role="tabpanel" aria-labelledby="tab-chest-log" hidden={tab !== "chest-log"}>
            <LootCalculator />
          </div>
          <div id="panel-calculator" role="tabpanel" aria-labelledby="tab-calculator" hidden={tab !== "calculator"}>
            <ManualCalculator />
          </div>
          <div id="panel-history" role="tabpanel" aria-labelledby="tab-history" hidden={tab !== "history"}>
            <HistoryPanel />
          </div>
        </main>

        <footer className="shrink-0 border-t border-border-soft bg-background/95 px-4 py-2 text-[11px] leading-snug text-muted sm:px-6">
          <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <p>
              Splits saved only in this browser. Market data from the{" "}
              <a
                href="https://www.albion-online-data.com/"
                target="_blank"
                rel="noreferrer"
                className="text-gold hover:underline"
              >
                Albion Online Data Project
              </a>
              · {itemNames.toLocaleString()} item names (built {generatedAt.slice(0, 10)}).
            </p>
            <p>© {new Date().getFullYear()} suryamssv</p>
          </div>
        </footer>
      </div>
    </HistoryProvider>
  );
}

function TabButton({
  id,
  controls,
  selected,
  onSelect,
  children,
}: {
  id: string;
  controls: string;
  selected: boolean;
  onSelect: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      id={id}
      aria-controls={controls}
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      onClick={onSelect}
      className={`min-h-9 rounded-md px-3 text-sm font-medium transition-colors ${
        selected ? "bg-gold text-background" : "text-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
