"use client";

import { useCallback, useId, useRef, useState } from "react";

/** Sample from the PRD, so a first-time visitor can try the flow immediately. */
export const SAMPLE_LOG = `"Date" "Player" "Item" "Enchantment" "Quality" "Amount"
"08/18/2026 11:49:51" "DemiG0Dz" "Adept's Fiend Cowl" "2" "4" "1"
"08/18/2026 11:49:51" "DemiG0Dz" "Adept's Bag" "1" "4" "1"
"08/18/2026 11:49:50" "DemiG0Dz" "Adept's Cape" "2" "3" "1"
"08/18/2026 11:49:50" "DemiG0Dz" "Journeyman's Riding Horse" "0" "1" "1"
"08/18/2026 11:49:49" "DemiG0Dz" "Adept's Dagger Pair" "2" "4" "1"
"08/18/2026 11:49:49" "DemiG0Dz" "Adept's Assassin Jacket" "2" "4" "1"
"08/18/2026 11:49:49" "DemiG0Dz" "Adept's Hellion Shoes" "2" "3" "1"
"08/18/2026 11:49:48" "DemiG0Dz" "Invisibility Potion" "0" "1" "2"`;

const ACCEPTED_EXTENSIONS = [".txt", ".csv", ".log"];
const MAX_FILE_BYTES = 2 * 1024 * 1024;

interface LogInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export default function LogInput({ value, onChange, disabled }: LogInputProps) {
  const textareaId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const readFile = useCallback(
    async (file: File) => {
      setFileError(null);
      const name = file.name.toLowerCase();
      if (!ACCEPTED_EXTENSIONS.some((extension) => name.endsWith(extension))) {
        setFileError(`Unsupported file "${file.name}". Upload a .txt or .csv chest log.`);
        return;
      }
      if (file.size > MAX_FILE_BYTES) {
        setFileError(`"${file.name}" is larger than 2 MB.`);
        return;
      }
      try {
        onChange(await file.text());
      } catch {
        setFileError("Could not read that file.");
      }
    },
    [onChange],
  );

  const pasteFromClipboard = useCallback(async () => {
    setFileError(null);
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) onChange(text);
      else setFileError("Clipboard is empty.");
    } catch {
      setFileError("Clipboard access was blocked. Paste into the box instead.");
    }
  }, [onChange]);

  const lineCount = value.trim() === "" ? 0 : value.trim().split(/\r?\n/).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={textareaId} className="text-sm font-medium text-foreground">
          Paste Albion Chest Log
        </label>
        <span className="text-xs text-muted tabular-nums">
          {lineCount} {lineCount === 1 ? "line" : "lines"}
        </span>
      </div>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files?.[0];
          if (file) void readFile(file);
        }}
        className={`relative rounded-xl border-2 border-dashed transition-colors ${
          dragging ? "border-gold bg-gold/5" : "border-border-soft bg-surface"
        }`}
      >
        <textarea
          id={textareaId}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          spellCheck={false}
          placeholder={'Paste log here...\n\n"08/18/2026 11:49:51" "Player" "Adept\'s Bag" "1" "4" "1"'}
          className="min-h-56 w-full resize-y rounded-xl bg-transparent p-4 font-mono text-xs leading-relaxed text-foreground outline-none placeholder:text-muted/60 focus:ring-2 focus:ring-gold/40 sm:min-h-64 sm:text-sm"
        />
        {dragging && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-background/70 text-sm font-medium text-gold">
            Drop chest log file
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className="min-h-11 rounded-lg border border-border-soft bg-surface-raised px-4 text-sm font-medium text-foreground transition-colors hover:border-gold-dim disabled:opacity-50"
        >
          Upload file
        </button>
        <button
          type="button"
          onClick={pasteFromClipboard}
          disabled={disabled}
          className="min-h-11 rounded-lg border border-border-soft bg-surface-raised px-4 text-sm font-medium text-foreground transition-colors hover:border-gold-dim disabled:opacity-50"
        >
          Paste from clipboard
        </button>
        <button
          type="button"
          onClick={() => onChange(SAMPLE_LOG)}
          disabled={disabled}
          className="min-h-11 rounded-lg border border-transparent px-4 text-sm font-medium text-muted transition-colors hover:text-gold disabled:opacity-50"
        >
          Load sample
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.csv,.log,text/plain,text/csv"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void readFile(file);
            event.target.value = "";
          }}
        />
      </div>

      {fileError && (
        <p role="alert" className="text-sm text-danger">
          {fileError}
        </p>
      )}
    </div>
  );
}
