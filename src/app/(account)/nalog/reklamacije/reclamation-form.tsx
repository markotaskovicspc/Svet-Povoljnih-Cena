"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ImagePlus, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type OrderOption = {
  number: string;
  createdAt: string;
  items: {
    sku: string;
    name: string;
    purchasedQty: number;
    remainingQty: number;
  }[];
};

type PendingPhoto = {
  id: string;
  file: File;
  previewUrl: string;
  status: "pending" | "uploading" | "done" | "error";
  publicUrl?: string;
  width: number;
  height: number;
  error?: string;
};

const MAX_PHOTOS = 5;
const MAX_SOURCE_PHOTO_BYTES = 15 * 1024 * 1024;
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const MAX_PHOTO_DIMENSION = 1600;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

const FIELD_ERROR_MESSAGES: Record<string, string> = {
  orderNumberOrFiscal: "Izaberite porudžbinu.",
  sku: "Izaberite artikal iz porudžbine.",
  quantity: "Količina mora biti u okviru preostale kupljene količine.",
  description: "Opis mora imati bar 5, a najviše 250 karaktera.",
  photos: "Proverite priložene fotografije.",
};

export function ReclamationForm({ orders }: { orders: OrderOption[] }) {
  const router = useRouter();
  const [orderNumber, setOrderNumber] = useState(orders[0]?.number ?? "");
  const [sku, setSku] = useState(orders[0]?.items[0]?.sku ?? "");
  const [quantity, setQuantity] = useState(1);
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedOrder = useMemo(
    () => orders.find((o) => o.number === orderNumber) ?? orders[0],
    [orders, orderNumber],
  );
  const selectedItem = selectedOrder?.items.find((item) => item.sku === sku);

  function resetForm() {
    setDescription("");
    setQuantity(1);
    clearPhotos();
    setFieldErrors({});
    setFormError(null);
  }

  function clearPhotos() {
    setPhotos((current) => {
      current.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
      return [];
    });
  }

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || !fileList.length) return;
    setFormError(null);
    const incoming = Array.from(fileList);
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) {
      setFormError(`Možete dodati najviše ${MAX_PHOTOS} fotografija.`);
      return;
    }

    const accepted: PendingPhoto[] = [];
    for (const file of incoming.slice(0, room)) {
      if (!ALLOWED_TYPES.includes(file.type)) {
        setFormError("Dozvoljeni formati fotografija su JPG, PNG i WEBP.");
        continue;
      }
      if (file.size > MAX_SOURCE_PHOTO_BYTES) {
        setFormError("Izvorna fotografija može imati najviše 15 MB.");
        continue;
      }
      try {
        const optimized = await optimizePhoto(file);
        accepted.push({
          id: `${optimized.file.name}-${optimized.file.size}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          file: optimized.file,
          previewUrl: URL.createObjectURL(optimized.file),
          width: optimized.width,
          height: optimized.height,
          status: "pending",
        });
      } catch {
        setFormError(
          "Fotografiju nije moguće obraditi. Probajte drugu JPG, PNG ili WEBP sliku.",
        );
      }
    }
    if (!accepted.length) return;

    setPhotos((prev) => [...prev, ...accepted]);

    for (const photo of accepted) {
      void uploadPhoto(photo);
    }
  }

  async function uploadPhoto(photo: PendingPhoto) {
    if (!selectedOrder || !sku) return;
    setPhotos((prev) =>
      prev.map((p) => (p.id === photo.id ? { ...p, status: "uploading" } : p)),
    );
    try {
      const presignRes = await fetch("/api/reclamations/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: photo.file.name,
          contentType: photo.file.type,
          bytes: photo.file.size,
          orderNumberOrFiscal: selectedOrder.number,
          sku,
          quantity,
        }),
      });
      const presignData = await presignRes.json().catch(() => null);
      if (!presignRes.ok || !presignData?.uploadUrl) {
        throw new Error(
          presignData?.message ?? "Slanje fotografije trenutno nije moguće.",
        );
      }
      const putRes = await fetch(presignData.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": photo.file.type },
        body: photo.file,
      });
      if (!putRes.ok) {
        throw new Error("Slanje fotografije nije uspelo.");
      }
      setPhotos((prev) =>
        prev.map((p) =>
          p.id === photo.id
            ? {
                ...p,
                status: "done",
                publicUrl: presignData.publicUrl as string,
              }
            : p,
        ),
      );
    } catch (err) {
      setPhotos((prev) =>
        prev.map((p) =>
          p.id === photo.id
            ? {
                ...p,
                status: "error",
                error:
                  err instanceof Error
                    ? err.message
                    : "Slanje fotografije nije uspelo.",
              }
            : p,
        ),
      );
    }
  }

  function removePhoto(id: string) {
    setPhotos((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    setFieldErrors({});
    setSuccess(null);

    if (!selectedOrder || !sku) {
      setFormError("Izaberite porudžbinu i artikal.");
      return;
    }
    if (photos.some((p) => p.status === "uploading")) {
      setFormError("Sačekajte da se fotografije završe sa slanjem.");
      return;
    }
    if (photos.some((p) => p.status === "error")) {
      setFormError(
        "Uklonite fotografije koje nisu uspešno poslate ili pokušajte ponovo.",
      );
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/reclamations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderNumberOrFiscal: selectedOrder.number,
          sku,
          quantity,
          description,
          photos: photos
            .filter((p) => p.status === "done" && p.publicUrl)
            .map((p) => ({
              url: p.publicUrl,
              width: p.width,
              height: p.height,
              bytes: p.file.size,
            })),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        if (data?.issues?.fieldErrors) {
          const mapped: Record<string, string> = {};
          for (const key of Object.keys(
            data.issues.fieldErrors as Record<string, string[]>,
          )) {
            mapped[key] = FIELD_ERROR_MESSAGES[key] ?? "Proverite ovo polje.";
          }
          setFieldErrors(mapped);
          setFormError("Proverite označena polja.");
        } else if (data?.reason === "ORDER_NOT_FOUND") {
          setFormError("Porudžbina nije pronađena.");
        } else if (data?.reason === "ITEM_NOT_FOUND") {
          setFormError("Izabrani artikal nije pronađen u porudžbini.");
        } else if (data?.reason === "UNAUTHORIZED") {
          setFormError("Ova porudžbina nije povezana sa vašim nalogom.");
        } else if (data?.reason === "INVALID_PHOTO") {
          setFormError(
            "Fotografija nije ispravno otpremljena. Uklonite je, dodajte ponovo i pokušajte još jednom.",
          );
        } else if (data?.reason === "QUANTITY_EXCEEDED") {
          setFormError(
            "Izabrana količina prelazi preostalu kupljenu količinu. Osvežite stranicu i pokušajte ponovo.",
          );
        } else if (res.status === 429) {
          setFormError(
            "Previše pokušaja u kratkom vremenu. Pokušajte ponovo kasnije.",
          );
        } else {
          setFormError("Slanje reklamacije nije uspelo. Pokušajte ponovo.");
        }
        return;
      }
      setSuccess(data.number as string);
      resetForm();
      router.refresh();
    } catch {
      setFormError("Slanje reklamacije nije uspelo. Proverite internet konekciju.");
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="mt-5 rounded-lg border border-success/30 bg-success/10 px-5 py-8 text-center">
        <CheckCircle2 className="mx-auto size-8 text-success" aria-hidden />
        <h3 className="mt-3 font-display text-xl text-ink-900">
          Reklamacija je prijavljena
        </h3>
        <p className="mt-1 text-sm text-ink-700">
          Broj reklamacije: <span className="font-mono">{success}</span>
        </p>
        <p className="mt-2 text-sm text-ink-600">
          Potvrdu, tok obrade i konačan status pratite na ovoj stranici.
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-5"
          onClick={() => setSuccess(null)}
        >
          Prijavi još jednu reklamaciju
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-5 grid gap-4" noValidate>
      <div className="grid gap-2">
        <Label htmlFor="orderNumber">Porudžbina</Label>
        <select
          id="orderNumber"
          value={orderNumber}
          onChange={(e) => {
            clearPhotos();
            setOrderNumber(e.target.value);
            const next = orders.find((o) => o.number === e.target.value);
            setSku(next?.items[0]?.sku ?? "");
            setQuantity(1);
          }}
          className="h-11 rounded-lg border border-input bg-white px-2.5 text-sm"
        >
          {orders.map((order) => (
            <option key={order.number} value={order.number}>
              {order.number} ·{" "}
              {new Date(order.createdAt).toLocaleDateString("sr-Latn-RS")}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="sku">Artikal</Label>
        <select
          id="sku"
          value={sku}
          onChange={(e) => {
            clearPhotos();
            setSku(e.target.value);
            setQuantity(1);
          }}
          className="h-11 rounded-lg border border-input bg-white px-2.5 text-sm"
        >
          {selectedOrder?.items.map((item) => (
            <option key={item.sku} value={item.sku}>
              {item.name} ({item.remainingQty} od {item.purchasedQty} kom dostupno)
            </option>
          ))}
        </select>
        {fieldErrors.sku ? (
          <p className="text-xs text-destructive">{fieldErrors.sku}</p>
        ) : null}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="quantity">Količina za reklamaciju</Label>
        <Input
          id="quantity"
          type="number"
          min={1}
          max={selectedItem?.remainingQty ?? 1}
          value={quantity}
          onChange={(event) => setQuantity(Number(event.target.value))}
          required
          className="h-11 bg-white"
        />
        <p className="text-xs text-ink-500">
          Preostalo za ovaj artikal: {selectedItem?.remainingQty ?? 0} kom.
        </p>
        {fieldErrors.quantity ? (
          <p className="text-xs text-destructive">{fieldErrors.quantity}</p>
        ) : null}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="description">Komentar / opis problema</Label>
        <Textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
          minLength={5}
          maxLength={250}
          rows={4}
          placeholder="Opišite nedostatak, oštećenje ili neusaglašenost sa opisom artikla."
          className="bg-white"
        />
        <div className="flex items-center justify-between text-xs text-ink-500">
          <span>{fieldErrors.description ?? ""}</span>
          <span>{description.length}/250</span>
        </div>
      </div>

      <div className="grid gap-2">
        <Label>
          Fotografije (do {MAX_PHOTOS}, automatski optimizovane na 1600 px i do 2 MB)
        </Label>
        <div className="flex flex-wrap gap-3">
          {photos.map((photo) => (
            <div
              key={photo.id}
              className="relative size-20 overflow-hidden rounded-md border border-border/70"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview, not a remote asset */}
              <img
                src={photo.previewUrl}
                alt=""
                className="size-full object-cover"
              />
              {photo.status === "uploading" ? (
                <div className="absolute inset-0 grid place-items-center bg-black/40">
                  <Loader2 className="size-4 animate-spin text-white" aria-hidden />
                </div>
              ) : null}
              {photo.status === "error" ? (
                <div className="absolute inset-0 grid place-items-center bg-destructive/70 px-1 text-center text-[10px] text-white">
                  Greška
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => removePhoto(photo.id)}
                className="absolute top-1 right-1 grid size-5 place-items-center rounded-full bg-black/60 text-white"
                aria-label="Ukloni fotografiju"
              >
                <X className="size-3" aria-hidden />
              </button>
            </div>
          ))}
          {photos.length < MAX_PHOTOS ? (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="grid size-20 place-items-center rounded-md border border-dashed border-border text-ink-400 transition hover:border-walnut/50 hover:text-walnut"
            >
              <ImagePlus className="size-5" aria-hidden />
            </button>
          ) : null}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={(e) => {
            void handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {formError ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {formError}
        </p>
      ) : null}

      <Button
        type="submit"
        size="lg"
        disabled={submitting || photos.some((p) => p.status === "uploading")}
        className="w-full gap-2"
      >
        {submitting ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : null}
        {submitting ? "Slanje..." : "Pošalji reklamaciju"}
      </Button>
    </form>
  );
}

async function optimizePhoto(file: File) {
  const decoded = await decodePhoto(file);
  try {
    let scale = Math.min(
      1,
      MAX_PHOTO_DIMENSION / Math.max(decoded.width, decoded.height),
    );

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const width = Math.max(1, Math.round(decoded.width * scale));
      const height = Math.max(1, Math.round(decoded.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("canvas_unavailable");
      context.drawImage(decoded.source, 0, 0, width, height);
      const quality = Math.max(0.62, 0.84 - attempt * 0.05);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/webp", quality),
      );
      if (blob && blob.size <= MAX_PHOTO_BYTES) {
        const baseName = file.name.replace(/\.[^.]+$/, "") || "fotografija";
        return {
          file: new File([blob], `${baseName}.webp`, { type: "image/webp" }),
          width,
          height,
        };
      }
      scale *= 0.82;
    }
    throw new Error("optimized_photo_too_large");
  } finally {
    decoded.dispose();
  }
}

async function decodePhoto(file: File): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  dispose: () => void;
}> {
  if ("createImageBitmap" in window) {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        dispose: () => bitmap.close(),
      };
    } catch {
      // Older WebKit versions can expose createImageBitmap but reject valid
      // mobile camera images; fall through to the HTMLImageElement decoder.
    }
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("photo_decode_failed"));
      element.src = objectUrl;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      dispose: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}
