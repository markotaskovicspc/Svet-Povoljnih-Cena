"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { NEWSLETTER_IMAGE_ACCEPT, validateNewsletterImageFile } from "@/lib/newsletter/image-file";
import { cn } from "@/lib/utils";

export function NewsletterImageField({ campaignId, url, onUrlChange, onUploaded }: {
  campaignId: string;
  url: string;
  onUrlChange: (url: string) => void;
  onUploaded: (url: string, filename: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const request = useRef<AbortController | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [uploaded, setUploaded] = useState(false);

  useEffect(() => () => { request.current?.abort(); }, []);

  function fail(message: string) {
    setError(message);
    if (input.current) {
      input.current.value = "";
      input.current.setCustomValidity(message);
    }
  }

  async function upload(files: File[]) {
    if (pending.current) return;
    setUploaded(false);
    if (files.length !== 1) {
      fail("Dodajte jednu sliku po bloku.");
      return;
    }
    const file = files[0];
    try { validateNewsletterImageFile(file); }
    catch (caught) { fail(caught instanceof Error ? caught.message : "Slika nije ispravna."); return; }
    pending.current = true;
    setUploading(true);
    setError("");
    input.current?.setCustomValidity("Sačekajte da se slika otpremi.");
    const controller = new AbortController();
    request.current = controller;
    try {
      const data = new FormData();
      data.set("campaignId", campaignId);
      data.set("file", file);
      const response = await fetch("/api/admin/newsletter-media", { method: "POST", body: data, signal: controller.signal });
      const result = await response.json().catch(() => null);
      if (!response.ok || typeof result?.url !== "string" || !result.url) {
        throw new Error(result?.error ?? "Otpremanje slike nije uspelo. Pokušajte ponovo.");
      }
      if (controller.signal.aborted) return;
      onUploaded(result.url, file.name);
      input.current?.setCustomValidity("");
      setUploaded(true);
    } catch (caught) {
      if (!controller.signal.aborted) fail(caught instanceof Error ? caught.message : "Otpremanje slike nije uspelo.");
    } finally {
      pending.current = false;
      if (!controller.signal.aborted) setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <input ref={input} type="file" accept={NEWSLETTER_IMAGE_ACCEPT} className="sr-only" aria-label="Slika za newsletter"
        onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); if (files.length) void upload(files); }} />
      <div
        className={cn("rounded-xl border-2 border-dashed p-4 text-center transition", dragging ? "border-walnut bg-walnut/10" : "border-border bg-muted-bg/40")}
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setDragging(true); }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
        onDrop={(event) => { event.preventDefault(); event.stopPropagation(); setDragging(false); void upload(Array.from(event.dataTransfer.files)); }}
        aria-busy={uploading}
      >
        <ImagePlus className="mx-auto mb-2 size-6 text-ink-500" aria-hidden="true" />
        <p className="text-sm font-medium">{uploading ? "Otpremanje slike…" : "Prevucite sliku ovde"}</p>
        <button type="button" disabled={uploading} onClick={() => input.current?.click()} className="mt-1 text-sm font-medium text-walnut underline disabled:opacity-50">
          ili izaberite sliku sa uređaja
        </button>
        <p className="mt-2 text-xs text-ink-500">JPG, PNG ili WebP · do 4 MB</p>
      </div>
      <Input value={url} disabled={uploading} aria-label="URL slike" placeholder="Ili nalepite https://… URL slike"
        onChange={(event) => { setError(""); setUploaded(false); input.current?.setCustomValidity(""); onUrlChange(event.target.value); }} />
      {uploading ? <p role="status" className="text-xs text-ink-500">Sačekajte završetak otpremanja pre čuvanja.</p> : null}
      {uploaded ? <p role="status" className="text-xs text-success">Slika je dodata. Kliknite „Sačuvaj novu verziju“ da sačuvate kampanju.</p> : null}
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
