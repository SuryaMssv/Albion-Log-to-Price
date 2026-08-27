"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useSyncExternalStore } from "react";
import {
  getHistorySnapshot,
  getServerHistorySnapshot,
  removeEntry,
  subscribeHistory,
  upsertEntry,
  writeHistory,
  type HistoryEntry,
} from "@/lib/history";

type RestoreHandler = (entry: HistoryEntry) => void;

interface HistoryContextValue {
  entries: HistoryEntry[];
  upsert: (entry: HistoryEntry) => void;
  remove: (id: string) => void;
  clear: () => void;
  open: (entry: HistoryEntry) => void;
  registerRestore: (handler: RestoreHandler) => () => void;
}

const HistoryContext = createContext<HistoryContextValue | null>(null);

export function HistoryProvider({
  children,
  onOpen,
}: {
  children: React.ReactNode;
  onOpen: (entry: HistoryEntry) => void;
}) {
  const entries = useSyncExternalStore(subscribeHistory, getHistorySnapshot, getServerHistorySnapshot);
  const restorers = useRef(new Set<RestoreHandler>());

  const upsert = useCallback((entry: HistoryEntry) => {
    writeHistory(upsertEntry(getHistorySnapshot(), entry));
  }, []);

  const remove = useCallback((id: string) => {
    writeHistory(removeEntry(getHistorySnapshot(), id));
  }, []);

  const clear = useCallback(() => {
    writeHistory([]);
  }, []);

  const registerRestore = useCallback((handler: RestoreHandler) => {
    restorers.current.add(handler);
    return () => {
      restorers.current.delete(handler);
    };
  }, []);

  const open = useCallback(
    (entry: HistoryEntry) => {
      for (const handler of restorers.current) handler(entry);
      onOpen(entry);
    },
    [onOpen],
  );

  const value = useMemo(
    () => ({ entries, upsert, remove, clear, open, registerRestore }),
    [entries, upsert, remove, clear, open, registerRestore],
  );

  return <HistoryContext.Provider value={value}>{children}</HistoryContext.Provider>;
}

export function useHistory(): HistoryContextValue {
  const value = useContext(HistoryContext);
  if (!value) throw new Error("useHistory must be used inside HistoryProvider");
  return value;
}
