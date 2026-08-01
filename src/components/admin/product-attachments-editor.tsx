"use client";

import { useRef, useState } from "react";
import { ExternalLink, Trash2 } from "lucide-react";
import {
  PRODUCT_ATTACHMENT_SECTION_OPTIONS,
  PRODUCT_DOCUMENT_ACCEPT,
  productAttachmentAdminLabel,
} from "@/lib/product-documents";
import { Button } from "@/components/ui/button";

export type EditableProductAttachment = {
  id: string;
  section: (typeof PRODUCT_ATTACHMENT_SECTION_OPTIONS)[number]["value"];
  label: string;
  url: string;
  order: number;
  origin: "SUPPLIER" | "ADMIN_UPLOAD";
  mimeType: string | null;
  sizeBytes: number | null;
};

type AttachmentSection = EditableProductAttachment["section"];

export function ProductAttachmentsEditor({
  productId,
  productSku,
  section,
  initialAttachments,
}: {
  productId: string;
  productSku: string;
  section: AttachmentSection;
  initialAttachments: EditableProductAttachment[];
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState(initialAttachments);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const sectionOption = PRODUCT_ATTACHMENT_SECTION_OPTIONS.find(
    (option) => option.value === section,
  );
  const sectionAttachments = attachments
    .filter((attachment) => attachment.section === section)
    .sort((left, right) => left.order - right.order);
  const adminAttachment = sectionAttachments.find(
    (attachment) => attachment.origin === "ADMIN_UPLOAD",
  );
  const generatedLabel = productAttachmentAdminLabel(productSku, section);

  const upload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setMessage({ ok: false, text: "Izaberite fajl." });
      return;
    }
    const formData = new FormData();
    formData.set("section", section);
    formData.set("file", file);
    setBusy("upload");
    setMessage(null);
    try {
      const response = await fetch(
        `/api/admin/products/${encodeURIComponent(productId)}/attachments`,
        { method: "POST", body: formData },
      );
      const payload = (await response.json().catch(() => null)) as
        | { attachment?: EditableProductAttachment; error?: string }
        | null;
      if (!response.ok || !payload?.attachment) {
        throw new Error(payload?.error ?? "Dokument nije dodat.");
      }
      setAttachments((current) => [
        ...current.filter(
          (attachment) =>
            attachment.section !== section ||
            attachment.origin !== "ADMIN_UPLOAD",
        ),
        payload.attachment!,
      ]);
      if (fileRef.current) fileRef.current.value = "";
      setMessage({
        ok: true,
        text: adminAttachment
          ? "Dokument je zamenjen."
          : "Dokument je dodat.",
      });
    } catch (error) {
      setMessage({
        ok: false,
        text: error instanceof Error ? error.message : "Dokument nije dodat.",
      });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (attachmentId: string) => {
    if (!window.confirm("Obrisati ovaj dokument sa PDP-a?")) return;
    setBusy(attachmentId);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/admin/products/${encodeURIComponent(productId)}/attachments/${encodeURIComponent(attachmentId)}`,
        { method: "DELETE" },
      );
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "Dokument nije obrisan.");
      }
      setAttachments((current) =>
        current.filter((attachment) => attachment.id !== attachmentId),
      );
      setMessage({ ok: true, text: "Dokument je obrisan." });
    } catch (error) {
      setMessage({
        ok: false,
        text: error instanceof Error ? error.message : "Dokument nije obrisan.",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      data-pdp-attachment-section={section}
      className="rounded-lg border border-border/60 bg-muted-bg/20 p-3"
    >
      <p className="text-xs text-ink-500">
        PDF, DOCX, JPG ili PNG · najviše 10 MB. Prikazni naziv: {" "}
        <strong className="font-semibold text-ink-700">{generatedLabel}</strong>
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept={PRODUCT_DOCUMENT_ACCEPT}
          aria-label={`Fajl za ${sectionOption?.label.toLocaleLowerCase("sr-Latn") ?? "PDP sekciju"}`}
          disabled={busy !== null}
          className="block min-w-0 flex-1 text-xs text-ink-600 file:mr-3 file:rounded-md file:border-0 file:bg-muted-bg file:px-3 file:py-2 file:font-semibold file:text-ink-700"
        />
        <Button
          type="button"
          size="sm"
          disabled={busy !== null}
          onClick={() => void upload()}
        >
          {busy === "upload"
            ? "Dodavanje…"
            : adminAttachment
              ? "Zameni dokument"
              : "Dodaj dokument"}
        </Button>
      </div>
      {message ? (
        <p
          role="status"
          className={`mt-2 rounded-md border px-2.5 py-1.5 text-xs ${
            message.ok
              ? "border-success/20 bg-success/5 text-success"
              : "border-danger/20 bg-danger/5 text-danger"
          }`}
        >
          {message.text}
        </p>
      ) : null}
      {sectionAttachments.length ? (
        <ul className="mt-3 space-y-2">
          {sectionAttachments.map((attachment) => (
            <li
              key={attachment.id}
              className="flex items-center gap-2 rounded-md border border-border/60 bg-surface px-3 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink-800">
                {attachment.origin === "ADMIN_UPLOAD"
                  ? generatedLabel
                  : attachment.label}
              </span>
              {attachment.origin === "SUPPLIER" ? (
                <span className="shrink-0 text-[10px] text-ink-400">
                  Dobavljački
                </span>
              ) : null}
              <a
                href={attachment.url}
                target="_blank"
                rel="noreferrer"
                className="rounded-md p-1.5 text-brand-blue hover:bg-brand-blue-50"
                aria-label="Otvori dokument"
              >
                <ExternalLink className="size-4" />
              </a>
              {attachment.origin === "ADMIN_UPLOAD" ? (
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => void remove(attachment.id)}
                  aria-label="Obriši dokument"
                  className="text-danger"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-ink-400">Nema dodatih dokumenata.</p>
      )}
    </div>
  );
}
