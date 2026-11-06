"use client";

import { useRef, useState } from "react";
import { ExternalLink, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  PROCUREMENT_DOCUMENT_ACCEPT,
  type ProcurementDocumentOwnerType,
  type ProcurementDocumentView,
} from "@/lib/admin/procurement-documents";

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("sr-Latn-RS", {
    maximumFractionDigits: 1,
  })} MB`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("sr-Latn-RS", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function ProcurementDocumentsPanel({
  ownerType,
  ownerId,
  initialDocuments,
}: {
  ownerType: ProcurementDocumentOwnerType;
  ownerId: string;
  initialDocuments: ProcurementDocumentView[];
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [documents, setDocuments] = useState(initialDocuments);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  const upload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setMessage({ ok: false, text: "Izaberite dokument." });
      return;
    }
    const formData = new FormData();
    formData.set("ownerType", ownerType);
    formData.set("ownerId", ownerId);
    formData.set("file", file);
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/erp/procurement-documents", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json().catch(() => null)) as
        | { document?: ProcurementDocumentView; error?: string }
        | null;
      if (!response.ok || !payload?.document) {
        throw new Error(payload?.error ?? "Dokument nije dodat.");
      }
      setDocuments((current) =>
        [payload.document!, ...current].sort(
          (left, right) =>
            new Date(right.createdAt).getTime() -
            new Date(left.createdAt).getTime(),
        ),
      );
      if (fileRef.current) fileRef.current.value = "";
      setMessage({
        ok: true,
        text:
          ownerType === "purchaseOrder"
            ? "Dokument je dodat i vidljiv je na povezanoj prijemnici."
            : "Dokument je dodat i vidljiv je na povezanoj porudžbenici.",
      });
    } catch (error) {
      setMessage({
        ok: false,
        text: error instanceof Error ? error.message : "Dokument nije dodat.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3" aria-label="Dokumenti nabavke">
      <div>
        <p className="text-xs text-ink-500">
          PDF, DOCX, JPG ili PNG · najviše 10 MB. Dokumenti se dele između
          povezane porudžbenice i prijemnice.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept={PROCUREMENT_DOCUMENT_ACCEPT}
            aria-label="Dokument nabavke"
            disabled={busy}
            className="block min-w-0 flex-1 text-xs text-ink-600 file:mr-3 file:rounded-md file:border-0 file:bg-muted-bg file:px-3 file:py-2 file:font-semibold file:text-ink-700"
          />
          <Button type="button" size="sm" disabled={busy} onClick={() => void upload()}>
            {busy ? "Dodavanje…" : "Dodaj dokument"}
          </Button>
        </div>
      </div>

      {message ? (
        <p
          role="status"
          className={`rounded-md border px-2.5 py-1.5 text-xs ${
            message.ok
              ? "border-success/20 bg-success/5 text-success"
              : "border-danger/20 bg-danger/5 text-danger"
          }`}
        >
          {message.text}
        </p>
      ) : null}

      {documents.length ? (
        <ul className="space-y-2">
          {documents.map((document) => (
            <li
              key={document.id}
              className="flex min-w-0 items-center gap-2 rounded-md border border-border/60 bg-surface px-3 py-2"
            >
              <FileText className="size-4 shrink-0 text-ink-400" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-ink-800">
                  {document.originalFilename}
                </span>
                <span className="block text-[10px] text-ink-400">
                  {document.ownerType === "purchaseOrder"
                    ? "Porudžbenica"
                    : "Prijemnica"}
                  {" · "}
                  {formatSize(document.sizeBytes)}
                  {" · "}
                  {formatDate(document.createdAt)}
                </span>
              </span>
              <a
                href={`/api/admin/erp/procurement-documents/${encodeURIComponent(document.id)}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-md p-1.5 text-brand-blue hover:bg-brand-blue-50"
                aria-label={`Otvori dokument ${document.originalFilename}`}
              >
                <ExternalLink className="size-4" />
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-ink-400">Nema dodatih dokumenata.</p>
      )}
    </section>
  );
}
