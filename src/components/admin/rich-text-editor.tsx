"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { PRODUCT_DOCUMENT_MAX_BYTES } from "@/lib/product-documents";

export function RichTextEditor({
  name,
  defaultValue,
  required = false,
  productId,
}: {
  name: string;
  defaultValue: string;
  required?: boolean;
  productId?: string;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const hiddenRef = useRef<HTMLInputElement>(null);
  const initializedRef = useRef(false);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  useLayoutEffect(() => {
    if (initializedRef.current || !editorRef.current) return;
    editorRef.current.innerHTML = defaultValue;
    if (hiddenRef.current) hiddenRef.current.value = defaultValue;
    initializedRef.current = true;
  }, [defaultValue]);

  const syncValue = () => {
    if (hiddenRef.current) {
      hiddenRef.current.value = editorRef.current?.innerHTML ?? "";
    }
  };

  const run = (command: string, argument?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, argument);
    syncValue();
  };

  const importDocx = async (file: File) => {
    setImportMessage(null);
    if (file.size > PRODUCT_DOCUMENT_MAX_BYTES) {
      setImportMessage({ ok: false, text: "DOCX ne sme biti veći od 10 MB." });
      return;
    }
    const existingText = editorRef.current?.innerText.trim() ?? "";
    if (
      existingText &&
      !window.confirm("Uvezeni DOCX će zameniti trenutni formatirani opis. Nastaviti?")
    ) {
      return;
    }
    setImporting(true);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch(
        `/api/admin/products/${encodeURIComponent(productId ?? "")}/description-import`,
        { method: "POST", body: formData },
      );
      const payload = (await response.json().catch(() => null)) as
        | { html?: string; warnings?: string[]; error?: string }
        | null;
      if (!response.ok || !payload?.html) {
        throw new Error(payload?.error ?? "DOCX opis nije uvezen.");
      }
      if (editorRef.current) editorRef.current.innerHTML = payload.html;
      syncValue();
      setImportMessage({
        ok: true,
        text: [
          "Opis je učitan u editor. Pregledajte ga i sačuvajte artikal.",
          ...(payload.warnings ?? []),
        ].join(" "),
      });
    } catch (error) {
      setImportMessage({
        ok: false,
        text: error instanceof Error ? error.message : "DOCX opis nije uvezen.",
      });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-lg border border-input bg-surface">
      <div className="flex flex-wrap gap-1 border-b border-border/60 bg-muted-bg/50 p-2">
        {[
          ["bold", "B"],
          ["italic", "I"],
          ["underline", "U"],
          ["insertUnorderedList", "• Lista"],
          ["insertOrderedList", "1. Lista"],
        ].map(([command, label]) => (
          <button
            key={command}
            type="button"
            onClick={() => run(command)}
            className="h-7 rounded-md border border-border bg-surface px-2 text-xs font-medium text-ink-700 hover:bg-muted-bg"
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => run("formatBlock", "h2")}
          className="h-7 rounded-md border border-border bg-surface px-2 text-xs font-medium text-ink-700 hover:bg-muted-bg"
        >
          Naslov
        </button>
        <button
          type="button"
          onClick={() => run("formatBlock", "p")}
          className="h-7 rounded-md border border-border bg-surface px-2 text-xs font-medium text-ink-700 hover:bg-muted-bg"
        >
          Pasus
        </button>
        <button
          type="button"
          onClick={() => run("removeFormat")}
          className="h-7 rounded-md border border-border bg-surface px-2 text-xs font-medium text-ink-700 hover:bg-muted-bg"
        >
          Očisti format
        </button>
        {productId ? (
          <label className="ml-auto inline-flex h-7 cursor-pointer items-center rounded-md border border-brand-blue/25 bg-brand-blue-50 px-2 text-xs font-semibold text-brand-blue hover:bg-brand-blue/10">
            {importing ? "Uvoz DOCX…" : "Uvezi DOCX"}
            <input
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              disabled={importing}
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.currentTarget.value = "";
                if (file) void importDocx(file);
              }}
            />
          </label>
        ) : null}
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={syncValue}
        className="prose prose-sm min-h-40 max-w-none px-3 py-2 text-sm text-ink-800 outline-none"
        role="textbox"
        aria-label="Formatirani opis za sajt"
        aria-multiline="true"
      />
      <input
        ref={hiddenRef}
        type="hidden"
        name={name}
        defaultValue={defaultValue}
        required={required}
      />
      {importMessage ? (
        <p
          role="status"
          className={`border-t px-3 py-2 text-xs ${
            importMessage.ok
              ? "border-success/20 bg-success/5 text-success"
              : "border-danger/20 bg-danger/5 text-danger"
          }`}
        >
          {importMessage.text}
        </p>
      ) : null}
    </div>
  );
}
