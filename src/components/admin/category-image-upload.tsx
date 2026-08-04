"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ImagePlus, RotateCcw, Upload } from "lucide-react";
import {
  CATEGORY_IMAGE_MAX_BYTES,
  validateCategoryImageFile,
} from "@/lib/categories/image-file";
import { cn } from "@/lib/utils";

const ACCEPTED_IMAGES =
  "image/png,image/jpeg,image/webp,image/avif,.png,.jpg,.jpeg,.webp,.avif";

export function CategoryImageUpload({
  currentUrl,
}: {
  currentUrl?: string | null;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const objectUrlRef = useRef("");
  const uploadedKeyRef = useRef("");
  const currentUrlRef = useRef(currentUrl ?? "");
  const selectionRef = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(currentUrl ?? "");
  const [selectedName, setSelectedName] = useState("");
  const [removed, setRemoved] = useState(false);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadedKey, setUploadedKey] = useState("");

  function cleanupStagedUpload(key: string) {
    if (!key) return;
    void fetch("/api/admin/category-uploads", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
      keepalive: true,
    }).catch(() => undefined);
  }

  function clearUploadedKey() {
    const key = uploadedKeyRef.current;
    uploadedKeyRef.current = "";
    setUploadedKey("");
    cleanupStagedUpload(key);
  }

  function releaseObjectUrl() {
    if (!objectUrlRef.current) return;
    URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = "";
  }

  function resetPreview() {
    selectionRef.current += 1;
    clearUploadedKey();
    if (inputRef.current) {
      inputRef.current.value = "";
      inputRef.current.setCustomValidity("");
    }
    releaseObjectUrl();
    setPreviewUrl(currentUrlRef.current);
    setSelectedName("");
    setRemoved(false);
    setUploading(false);
    setError("");
  }

  useEffect(() => {
    const input = inputRef.current;
    const form = input?.form;
    if (!form) return;
    form.addEventListener("reset", resetPreview);
    return () => {
      form.removeEventListener("reset", resetPreview);
      selectionRef.current += 1;
      cleanupStagedUpload(uploadedKeyRef.current);
      uploadedKeyRef.current = "";
      releaseObjectUrl();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const nextUrl = currentUrl ?? "";
    if (currentUrlRef.current === nextUrl) return;

    currentUrlRef.current = nextUrl;
    selectionRef.current += 1;
    const stagedKey = uploadedKeyRef.current;
    uploadedKeyRef.current = "";
    cleanupStagedUpload(stagedKey);
    if (inputRef.current) {
      inputRef.current.value = "";
      inputRef.current.setCustomValidity("");
    }
    releaseObjectUrl();
    setUploadedKey("");
    setPreviewUrl(nextUrl);
    setSelectedName("");
    setRemoved(false);
    setUploading(false);
    setError("");
    // A changed prop is the authoritative result of the completed Server Action.
  }, [currentUrl]);

  async function stageFile(file: File, selection: number) {
    let stagedKey = "";
    try {
      const presignResponse = await fetch("/api/admin/category-uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          bytes: file.size,
        }),
      });
      const presign = await presignResponse.json().catch(() => null);
      if (!presignResponse.ok || !presign?.uploadUrl || !presign?.key) {
        throw new Error(presign?.error ?? "Priprema slanja slike nije uspela.");
      }
      stagedKey = String(presign.key);

      const uploadResponse = await fetch(String(presign.uploadUrl), {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!uploadResponse.ok) {
        throw new Error("Slanje slike nije uspelo. Pokušajte ponovo.");
      }
      if (selectionRef.current !== selection) {
        cleanupStagedUpload(stagedKey);
        return;
      }

      uploadedKeyRef.current = stagedKey;
      setUploadedKey(stagedKey);
      setUploading(false);
      setError("");
      if (inputRef.current) {
        inputRef.current.value = "";
        inputRef.current.setCustomValidity("");
      }
    } catch (caught) {
      if (stagedKey) cleanupStagedUpload(stagedKey);
      if (selectionRef.current !== selection) return;
      const message =
        caught instanceof Error
          ? caught.message
          : "Slanje slike nije uspelo. Pokušajte ponovo.";
      setUploading(false);
      setUploadedKey("");
      uploadedKeyRef.current = "";
      setError(message);
      if (inputRef.current) {
        inputRef.current.value = "";
        inputRef.current.setCustomValidity(message);
      }
    }
  }

  function applyFile(file: File | undefined) {
    if (!file) return;
    try {
      validateCategoryImageFile(file);
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Slika nije ispravna.";
      if (inputRef.current) {
        inputRef.current.value = "";
        inputRef.current.setCustomValidity(message);
      }
      selectionRef.current += 1;
      clearUploadedKey();
      releaseObjectUrl();
      setPreviewUrl(currentUrlRef.current);
      setSelectedName("");
      setRemoved(false);
      setUploading(false);
      setError(message);
      return;
    }

    const input = inputRef.current;
    if (!input) return;
    selectionRef.current += 1;
    const selection = selectionRef.current;
    clearUploadedKey();
    input.setCustomValidity("Sačekajte da se slika otpremi.");

    releaseObjectUrl();
    const nextPreview = URL.createObjectURL(file);
    objectUrlRef.current = nextPreview;
    setPreviewUrl(nextPreview);
    setSelectedName(file.name);
    setRemoved(false);
    setUploading(true);
    setError("");
    void stageFile(file, selection);
  }

  function removeCurrentSelection() {
    selectionRef.current += 1;
    clearUploadedKey();
    if (inputRef.current) {
      inputRef.current.value = "";
      inputRef.current.setCustomValidity("");
    }
    releaseObjectUrl();
    setPreviewUrl("");
    setSelectedName("");
    setRemoved(true);
    setUploading(false);
    setError("");
  }

  const hasCurrentImage = Boolean(currentUrl) && !removed;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-[0.12em] text-ink-500">
          Slika kategorije
        </span>
        <span className="text-[11px] text-ink-400">
          PNG, JPG, WebP ili AVIF · do {CATEGORY_IMAGE_MAX_BYTES / 1024 / 1024} MB
        </span>
      </div>

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={ACCEPTED_IMAGES}
        className="sr-only"
        aria-describedby={`${inputId}-hint${error ? ` ${inputId}-error` : ""}`}
        onChange={(event) => applyFile(event.currentTarget.files?.[0])}
      />
      {uploadedKey ? (
        <input type="hidden" name="imageUploadKey" value={uploadedKey} />
      ) : null}
      {removed ? <input type="hidden" name="removeImage" value="true" /> : null}

      <label
        htmlFor={inputId}
        aria-busy={uploading}
        className={cn(
          "group relative flex min-h-40 cursor-pointer overflow-hidden rounded-xl border-2 border-dashed bg-muted-bg/35 transition",
          "focus-within:border-walnut focus-within:ring-3 focus-within:ring-walnut/15",
          dragging
            ? "border-walnut bg-walnut/8"
            : "border-border/80 hover:border-walnut/65 hover:bg-walnut/5",
        )}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDragging(false);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          applyFile(event.dataTransfer.files?.[0]);
        }}
      >
        {previewUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt=""
              className="absolute inset-0 size-full object-cover"
            />
            <span className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-black/5 transition group-hover:from-black/80" />
            <span className="relative mt-auto flex w-full items-center justify-between gap-3 p-3 text-white">
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">
                  {selectedName || "Trenutna slika"}
                </span>
                <span className="block text-xs text-white/80">
                  {uploading
                    ? "Otpremanje slike…"
                    : uploadedKey
                      ? "Slika je spremna za čuvanje"
                      : "Prevucite novu sliku ili kliknite za zamenu"}
                </span>
              </span>
              <RotateCcw className="size-5 shrink-0" aria-hidden="true" />
            </span>
          </>
        ) : (
          <span className="m-auto flex max-w-sm flex-col items-center gap-2 px-4 py-6 text-center">
            <span className="flex size-11 items-center justify-center rounded-full bg-walnut/10 text-walnut">
              {dragging ? (
                <Upload className="size-5" aria-hidden="true" />
              ) : (
                <ImagePlus className="size-5" aria-hidden="true" />
              )}
            </span>
            <span className="text-sm font-semibold text-ink-800">
              Prevucite sliku ovde
            </span>
            <span className="text-xs text-ink-500">
              ili kliknite da je izaberete sa računara ili telefona
            </span>
          </span>
        )}
      </label>

      <div className="flex items-start justify-between gap-3">
        <span id={`${inputId}-hint`} className="text-xs text-ink-500">
          Najbolje izgleda vodoravna fotografija. Na izlogu se trenutno prikazuje
          samo za glavne kategorije, kao pločica u mobilnom meniju; slike
          podkategorija se čuvaju, ali još nisu prikazane.
        </span>
        {hasCurrentImage || selectedName ? (
          <button
            type="button"
            className="shrink-0 text-xs font-medium text-destructive hover:underline"
            onClick={removeCurrentSelection}
          >
            Ukloni
          </button>
        ) : null}
      </div>
      {uploading ? (
        <p role="status" className="text-xs text-ink-500">
          Otpremanje slike je u toku. Sačekajte pre čuvanja forme.
        </p>
      ) : uploadedKey ? (
        <p role="status" className="text-xs text-success">
          Slika je otpremljena i spremna za čuvanje.
        </p>
      ) : null}
      {error ? (
        <p
          id={`${inputId}-error`}
          role="alert"
          className="text-xs text-destructive"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
