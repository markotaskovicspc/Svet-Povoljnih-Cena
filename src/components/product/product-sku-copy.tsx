"use client";

import { useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

export function ProductSkuCopy({ sku }: { sku: string }) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copySku = async () => {
    try {
      await navigator.clipboard.writeText(sku);
      setCopied(true);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-mono font-semibold text-ink-700">{sku}</span>
      <button
        type="button"
        onClick={copySku}
        aria-label={copied ? `Šifra artikla ${sku} je kopirana` : `Kopiraj šifru artikla ${sku}`}
        title={copied ? "Kopirano" : "Kopiraj šifru artikla"}
        className="inline-flex size-7 items-center justify-center rounded-full text-ink-500 transition hover:bg-muted-bg hover:text-brand-blue focus-visible:ring-2 focus-visible:ring-brand-blue/35 focus-visible:outline-none"
      >
        {copied ? (
          <Check className="size-3.5 text-success" aria-hidden />
        ) : (
          <Copy className="size-3.5" aria-hidden />
        )}
      </button>
    </span>
  );
}
