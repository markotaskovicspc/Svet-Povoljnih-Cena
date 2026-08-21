"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ImagePlus, RotateCcw, Upload } from "lucide-react";
import {
  BANNER_IMAGE_MAX_BYTES,
  type BannerImageVariant,
  mergeBannerUploadFiles,
  shouldContinuePendingBannerSvg,
  splitBannerUploadFiles,
  validateBannerImageFile,
} from "@/lib/banners/image-file";
import { cn } from "@/lib/utils";

const ACCEPTED_IMAGES =
  "image/png,image/jpeg,image/webp,image/avif,image/svg+xml,.png,.jpg,.jpeg,.webp,.avif,.svg";

class SvgCompanionUploadError extends Error {
  constructor(readonly missing: string[]) {
    super("SVG koristi prateću sliku.");
  }
}

export function BannerImageUpload({
  name,
  label,
  currentUrl,
  required = false,
  removeName,
  aspect = "wide",
  hint,
  placement,
  variant,
}: {
  name: string;
  label: string;
  currentUrl?: string | null;
  required?: boolean;
  removeName?: string;
  aspect?: "wide" | "mobile";
  hint: string;
  placement: string;
  variant: BannerImageVariant;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(currentUrl ?? "");
  const [selectedName, setSelectedName] = useState("");
  const [removed, setRemoved] = useState(false);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadedKey, setUploadedKey] = useState("");
  const objectUrlRef = useRef("");
  const uploadedKeyRef = useRef("");
  const pendingSvgRef = useRef<{
    primary: File;
    companions: File[];
    missing: string[];
  } | null>(null);
  const selectionRef = useRef(0);
  const uploadKeyName = name.replace(/File$/, "UploadKey");

  function cleanupStagedUpload(key: string) {
    if (!key) return;
    void fetch("/api/admin/banner-uploads", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, placement, variant }),
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
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = "";
    }
  }

  function resetPreview() {
    selectionRef.current += 1;
    pendingSvgRef.current = null;
    clearUploadedKey();
    if (inputRef.current) {
      inputRef.current.value = "";
      inputRef.current.setCustomValidity("");
    }
    releaseObjectUrl();
    setPreviewUrl(currentUrl ?? "");
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
      pendingSvgRef.current = null;
      releaseObjectUrl();
    };
    // The current URL is fixed for the lifetime of an individual edit form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function stageFile(
    file: File,
    companions: File[],
    selection: number,
  ) {
    let stagedKey = "";
    try {
      if (file.type === "image/svg+xml") {
        const formData = new FormData();
        formData.set("file", file);
        formData.set("placement", placement);
        formData.set("variant", variant);
        for (const companion of companions) {
          formData.append("companions", companion);
        }
        const response = await fetch("/api/admin/banner-uploads", {
          method: "POST",
          body: formData,
        });
        const payload = await response.json().catch(() => null);
        if (
          !response.ok &&
          payload?.code === "SVG_COMPANION_REQUIRED" &&
          Array.isArray(payload.missing)
        ) {
          throw new SvgCompanionUploadError(
            payload.missing.filter(
              (value: unknown): value is string => typeof value === "string",
            ),
          );
        }
        if (!response.ok || !payload?.key) {
          throw new Error(payload?.error ?? "Slanje SVG slike nije uspelo.");
        }
        stagedKey = String(payload.key);
        if (selectionRef.current !== selection) {
          cleanupStagedUpload(stagedKey);
          return;
        }
        uploadedKeyRef.current = stagedKey;
        pendingSvgRef.current = null;
        setUploadedKey(stagedKey);
        setUploading(false);
        setError("");
        if (payload.publicUrl) {
          releaseObjectUrl();
          setPreviewUrl(String(payload.publicUrl));
        }
        if (inputRef.current) {
          inputRef.current.value = "";
          inputRef.current.setCustomValidity("");
        }
        return;
      }

      const presignResponse = await fetch("/api/admin/banner-uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          bytes: file.size,
          placement,
          variant,
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
      pendingSvgRef.current = null;
      setUploadedKey(stagedKey);
      setUploading(false);
      setError("");
      if (inputRef.current) {
        // The original bytes have reached Supabase directly. Clearing the file
        // keeps the subsequent Server Action well below Vercel's 4.5 MB cap.
        inputRef.current.value = "";
        inputRef.current.setCustomValidity("");
      }
    } catch (caught) {
      if (stagedKey) cleanupStagedUpload(stagedKey);
      if (selectionRef.current !== selection) return;
      const message =
        caught instanceof SvgCompanionUploadError
          ? caught.missing.length === 1
            ? `Dodajte i prateću sliku „${caught.missing[0]}” — prevucite je ovde ili je izaberite.`
            : `Dodajte i prateće slike: ${caught.missing.join(", ")} — prevucite ih ovde ili ih izaberite.`
          : caught instanceof Error
            ? caught.message
            : "Slanje slike nije uspelo. Pokušajte ponovo.";
      if (caught instanceof SvgCompanionUploadError) {
        pendingSvgRef.current = {
          primary: file,
          companions,
          missing: caught.missing,
        };
      } else {
        pendingSvgRef.current = null;
      }
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

  function applyFiles(incoming: File[]) {
    if (!incoming.length) return;
    const pending = pendingSvgRef.current;
    const files = shouldContinuePendingBannerSvg(incoming, pending?.missing)
      ? mergeBannerUploadFiles(
          [pending!.primary, ...pending!.companions],
          incoming,
        )
      : incoming;
    let file: File;
    let companions: File[];
    try {
      const selected = splitBannerUploadFiles(files);
      file = selected.primary;
      companions = selected.companions;
      validateBannerImageFile(file);
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Slika nije ispravna.";
      if (inputRef.current) {
        inputRef.current.value = "";
        inputRef.current.setCustomValidity(message);
      }
      selectionRef.current += 1;
      pendingSvgRef.current = null;
      clearUploadedKey();
      releaseObjectUrl();
      setPreviewUrl(currentUrl ?? "");
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
    pendingSvgRef.current = null;
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
    void stageFile(file, companions, selection);
  }

  function removeCurrentSelection() {
    selectionRef.current += 1;
    pendingSvgRef.current = null;
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
          {label}
        </span>
        <span className="text-[11px] text-ink-400">
          PNG, JPG, WebP, AVIF ili SVG · do {BANNER_IMAGE_MAX_BYTES / 1024 / 1024} MB
        </span>
      </div>

      <input
        ref={inputRef}
        id={inputId}
        name={name}
        type="file"
        multiple
        accept={ACCEPTED_IMAGES}
        className="sr-only"
        aria-describedby={`${inputId}-hint${error ? ` ${inputId}-error` : ""}`}
        onChange={(event) =>
          applyFiles(Array.from(event.currentTarget.files ?? []))
        }
      />
      {uploadedKey ? (
        <input type="hidden" name={uploadKeyName} value={uploadedKey} />
      ) : null}
      {removeName && removed ? (
        <input type="hidden" name={removeName} value="true" />
      ) : null}

      <label
        htmlFor={inputId}
        aria-busy={uploading}
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
          if (
            !event.currentTarget.contains(event.relatedTarget as Node | null)
          ) {
            setDragging(false);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          applyFiles(Array.from(event.dataTransfer.files ?? []));
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
          {hint}
          {required && !hasCurrentImage ? " Obavezna slika." : ""}
          {" "}Ako SVG koristi prateću sliku, dodajte oba fajla zajedno ili
          jedan za drugim.
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
