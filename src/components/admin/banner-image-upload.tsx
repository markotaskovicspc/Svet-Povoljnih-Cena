"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ImagePlus, RotateCcw, Upload } from "lucide-react";
import {
  BANNER_IMAGE_MAX_BYTES,
  validateBannerImageFile,
} from "@/lib/banners/image-file";
import { cn } from "@/lib/utils";

const ACCEPTED_IMAGES =
  "image/png,image/jpeg,image/webp,image/avif,.png,.jpg,.jpeg,.webp,.avif";

export function BannerImageUpload({
  name,
  label,
  currentUrl,
  required = false,
  removeName,
  aspect = "wide",
  hint,
}: {
  name: string;
  label: string;
  currentUrl?: string | null;
  required?: boolean;
  removeName?: string;
  aspect?: "wide" | "mobile";
  hint: string;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(currentUrl ?? "");
  const [selectedName, setSelectedName] = useState("");
  const [removed, setRemoved] = useState(false);
  const [error, setError] = useState("");
  const objectUrlRef = useRef("");

  function releaseObjectUrl() {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = "";
    }
  }

  function resetPreview() {
    releaseObjectUrl();
    setPreviewUrl(currentUrl ?? "");
    setSelectedName("");
    setRemoved(false);
    setError("");
  }

  useEffect(() => {
    const input = inputRef.current;
    const form = input?.form;
    if (!form) return;
    form.addEventListener("reset", resetPreview);
    return () => {
      form.removeEventListener("reset", resetPreview);
      releaseObjectUrl();
    };
    // The current URL is fixed for the lifetime of an individual edit form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyFile(file: File | undefined) {
    if (!file) return;
    try {
      validateBannerImageFile(file);
    } catch (caught) {
      if (inputRef.current) inputRef.current.value = "";
      releaseObjectUrl();
      setPreviewUrl(currentUrl ?? "");
      setSelectedName("");
      setRemoved(false);
      setError(
        caught instanceof Error ? caught.message : "Slika nije ispravna.",
      );
      return;
    }

    const input = inputRef.current;
    if (!input) return;
    if (input.files?.[0] !== file) {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
    }

    releaseObjectUrl();
    const nextPreview = URL.createObjectURL(file);
    objectUrlRef.current = nextPreview;
    setPreviewUrl(nextPreview);
    setSelectedName(file.name);
    setRemoved(false);
    setError("");
  }

  function removeCurrentSelection() {
    if (inputRef.current) inputRef.current.value = "";
    releaseObjectUrl();
    setPreviewUrl("");
    setSelectedName("");
    setRemoved(true);
    setError("");
  }

  const hasCurrentImage = Boolean(currentUrl) && !removed;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-[0.12em] text-ink-500">
          {label}
        </span>
        <span className="text-[11px] text-ink-400">
          PNG, JPG, WebP ili AVIF · do {BANNER_IMAGE_MAX_BYTES / 1024 / 1024} MB
        </span>
      </div>

      <input
        ref={inputRef}
        id={inputId}
        name={name}
        type="file"
        accept={ACCEPTED_IMAGES}
        className="sr-only"
        aria-describedby={`${inputId}-hint${error ? ` ${inputId}-error` : ""}`}
        onChange={(event) => applyFile(event.currentTarget.files?.[0])}
      />
      {removeName && removed ? (
        <input type="hidden" name={removeName} value="true" />
      ) : null}

      <label
        htmlFor={inputId}
        className={cn(
          "group relative flex cursor-pointer overflow-hidden rounded-xl border-2 border-dashed bg-muted-bg/35 transition",
          "focus-within:border-walnut focus-within:ring-3 focus-within:ring-walnut/15",
          dragging
            ? "border-walnut bg-walnut/8"
            : "border-border/80 hover:border-walnut/65 hover:bg-walnut/5",
          aspect === "mobile" ? "min-h-52" : "min-h-40",
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
              className={cn(
                "absolute inset-0 size-full",
                aspect === "mobile" ? "object-contain" : "object-cover",
              )}
            />
            <span className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-black/5 transition group-hover:from-black/80" />
            <span className="relative mt-auto flex w-full items-center justify-between gap-3 p-3 text-white">
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">
                  {selectedName || "Trenutna slika"}
                </span>
                <span className="block text-xs text-white/80">
                  Prevucite novu sliku ili kliknite za zamenu
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
              ili kliknite da je izaberete sa računara
            </span>
          </span>
        )}
      </label>

      <div className="flex items-start justify-between gap-3">
        <span id={`${inputId}-hint`} className="text-xs text-ink-500">
          {hint}
          {required && !hasCurrentImage ? " Obavezna slika." : ""}
        </span>
        {removeName && (hasCurrentImage || selectedName) ? (
          <button
            type="button"
            className="shrink-0 text-xs font-medium text-destructive hover:underline"
            onClick={removeCurrentSelection}
          >
            Ukloni
          </button>
        ) : null}
      </div>
      {error ? (
        <p id={`${inputId}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
