"use client";

import { useRef } from "react";
import { parseExportJson } from "@/lib/export";
import type { HistoryEntry } from "@/lib/history";

const MAX_FILE_BYTES = 2 * 1024 * 1024;

interface JsonUploadButtonProps {
  onLoaded: (entry: HistoryEntry) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}

export default function JsonUploadButton({ onLoaded, onError, disabled }: JsonUploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        className="min-h-8 rounded-md border border-border-soft bg-surface-raised px-3 text-xs font-medium text-foreground transition-colors hover:border-gold-dim disabled:opacity-50"
      >
        Upload JSON
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          void readJsonFile(file, onLoaded, onError);
        }}
      />
    </>
  );
}

async function readJsonFile(
  file: File,
  onLoaded: (entry: HistoryEntry) => void,
  onError: (message: string) => void,
): Promise<void> {
  if (!file.name.toLowerCase().endsWith(".json")) {
    onError(`Unsupported file "${file.name}". Upload a loot split .json export.`);
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    onError(`"${file.name}" is larger than 2 MB.`);
    return;
  }
  try {
    const entry = parseExportJson(await file.text());
    if (!entry) {
      onError("That file is not a loot split JSON export.");
      return;
    }
    onLoaded(entry);
  } catch {
    onError("Could not read that file.");
  }
}
