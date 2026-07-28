"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ExternalLink, Trash2 } from "lucide-react";
import {
  PRODUCT_ATTACHMENT_SECTION_OPTIONS,
  PRODUCT_DOCUMENT_ACCEPT,
} from "@/lib/product-documents";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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

export function ProductAttachmentsEditor({
  productId,
  initialAttachments,
}: {
  productId: string;
  initialAttachments: EditableProductAttachment[];
}) {
  const router = useRouter();
  const attachments = initialAttachments;
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  const refresh = () => {
    router.refresh();
  };

  const upload = async (
    event: React.FormEvent<HTMLFormElement>,
    section: EditableProductAttachment["section"],
  ) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    formData.set("section", section);
    setBusy(`upload:${section}`);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/admin/products/${encodeURIComponent(productId)}/attachments`,
        { method: "POST", body: formData },
      );
      const payload = (await response.json().catch(() => null)) as
        | {
            attachment?: Pick<
              EditableProductAttachment,
              "id" | "label" | "section" | "order"
            >;
            error?: string;
          }
        | null;
      if (!response.ok || !payload?.attachment) {
        throw new Error(payload?.error ?? "Dokument nije dodat.");
      }
      form.reset();
      setMessage({ ok: true, text: "Dokument je dodat." });
      refresh();
    } catch (error) {
      setMessage({
        ok: false,
        text: error instanceof Error ? error.message : "Dokument nije dodat.",
      });
    } finally {
      setBusy(null);
    }
  };

  const patch = async (
    attachmentId: string,
    input: { label?: string; direction?: "up" | "down" },
  ) => {
    setBusy(attachmentId);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/admin/products/${encodeURIComponent(productId)}/attachments/${encodeURIComponent(attachmentId)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!response.ok) throw new Error(payload?.error ?? "Izmena nije sačuvana.");
      setMessage({ ok: true, text: "Dokument je sačuvan." });
      refresh();
    } catch (error) {
      setMessage({
        ok: false,
        text: error instanceof Error ? error.message : "Izmena nije sačuvana.",
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
      if (!response.ok) throw new Error(payload?.error ?? "Dokument nije obrisan.");
      setMessage({ ok: true, text: "Dokument je obrisan." });
      refresh();
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
    <div className="space-y-4">
      {message ? (
        <p
          role="status"
          className={`rounded-lg border px-3 py-2 text-sm ${
            message.ok
              ? "border-success/20 bg-success/5 text-success"
              : "border-danger/20 bg-danger/5 text-danger"
          }`}
        >
          {message.text}
        </p>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-2">
        {PRODUCT_ATTACHMENT_SECTION_OPTIONS.map((section) => {
          const sectionAttachments = attachments
            .filter((attachment) => attachment.section === section.value)
            .sort((left, right) => left.order - right.order);
          return (
            <section
              key={section.value}
              className="rounded-xl border border-border/70 bg-surface p-4"
            >
              <h3 className="font-semibold text-ink-900">{section.label}</h3>
              <p className="mt-1 text-xs text-ink-500">
                PDF, DOCX, JPG ili PNG · najviše 10 MB po fajlu
              </p>
              <form
                className="mt-3 grid gap-2"
                onSubmit={(event) => void upload(event, section.value)}
              >
                <Input name="label" required maxLength={160} placeholder="Naziv dokumenta" />
                <input
                  name="file"
                  type="file"
                  required
                  accept={PRODUCT_DOCUMENT_ACCEPT}
                  className="block w-full text-xs text-ink-600 file:mr-3 file:rounded-md file:border-0 file:bg-muted-bg file:px-3 file:py-2 file:font-semibold file:text-ink-700"
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={busy !== null}
                  className="justify-self-start"
                >
                  {busy === `upload:${section.value}` ? "Dodavanje…" : "Dodaj dokument"}
                </Button>
              </form>
              {sectionAttachments.length ? (
                <ul className="mt-4 space-y-2">
                  {sectionAttachments.map((attachment, index) => (
                    <li
                      key={attachment.id}
                      className="rounded-lg border border-border/60 bg-muted-bg/30 p-2"
                    >
                      <div className="flex items-center gap-2">
                        <Input
                          aria-label="Naziv dokumenta"
                          defaultValue={attachment.label}
                          disabled={attachment.origin !== "ADMIN_UPLOAD" || busy === attachment.id}
                          onBlur={(event) => {
                            const label = event.currentTarget.value.trim();
                            if (label && label !== attachment.label) {
                              void patch(attachment.id, { label });
                            }
                          }}
                        />
                        <a
                          href={attachment.url}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-md p-2 text-brand-blue hover:bg-brand-blue-50"
                          aria-label="Otvori dokument"
                        >
                          <ExternalLink className="size-4" />
                        </a>
                      </div>
                      <div className="mt-2 flex items-center gap-1">
                        {attachment.origin === "ADMIN_UPLOAD" ? (
                          <>
                            <Button
                              type="button"
                              size="icon"
                              variant="outline"
                              disabled={index === 0 || busy !== null}
                              onClick={() => void patch(attachment.id, { direction: "up" })}
                              aria-label="Pomeri gore"
                            >
                              <ArrowUp className="size-3.5" />
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="outline"
                              disabled={index === sectionAttachments.length - 1 || busy !== null}
                              onClick={() => void patch(attachment.id, { direction: "down" })}
                              aria-label="Pomeri dole"
                            >
                              <ArrowDown className="size-3.5" />
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="outline"
                              disabled={busy !== null}
                              onClick={() => void remove(attachment.id)}
                              aria-label="Obriši dokument"
                              className="ml-auto text-danger"
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </>
                        ) : (
                          <span className="text-xs text-ink-500">
                            Dobavljački dokument je zaštićen od brisanja.
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-xs text-ink-400">Nema dodatih dokumenata.</p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
