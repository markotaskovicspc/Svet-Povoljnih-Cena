"use client";

import { useMemo, useRef, useState } from "react";
import { CheckCircle2, ImagePlus, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type OrderOption = {
  number: string;
  createdAt: string;
  items: { sku: string; name: string; qty: number }[];
};

type Defaults = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
};

type PendingPhoto = {
  id: string;
  file: File;
  previewUrl: string;
  status: "pending" | "uploading" | "done" | "error";
  publicUrl?: string;
  error?: string;
};

const MAX_PHOTOS = 5;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

const FIELD_ERROR_MESSAGES: Record<string, string> = {
  orderNumberOrFiscal: "Izaberite porudžbinu.",
  sku: "Izaberite artikal iz porudžbine.",
  customerFirst: "Unesite ime (najmanje 2 slova).",
  customerLast: "Unesite prezime (najmanje 2 slova).",
  customerEmail: "Unesite ispravnu e-adresu.",
  customerPhone: "Unesite ispravan broj telefona (najmanje 8 cifara).",
  description: "Opis mora imati bar 5, a najviše 250 karaktera.",
  notifyVia: "Izaberite način obaveštavanja.",
  photos: "Proverite priložene fotografije.",
};

export function ReclamationForm({
  orders,
  defaults,
}: {
  orders: OrderOption[];
  defaults: Defaults;
}) {
  const [orderNumber, setOrderNumber] = useState(orders[0]?.number ?? "");
  const [sku, setSku] = useState(orders[0]?.items[0]?.sku ?? "");
  const [firstName, setFirstName] = useState(defaults.firstName);
  const [lastName, setLastName] = useState(defaults.lastName);
  const [email, setEmail] = useState(defaults.email);
  const [phone, setPhone] = useState(defaults.phone);
  const [notifyVia, setNotifyVia] = useState<"EMAIL" | "PHONE">(
    defaults.email ? "EMAIL" : "PHONE",
  );
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

  function resetForm() {
    setDescription("");
    setPhotos([]);
    setFieldErrors({});
    setFormError(null);
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
      if (file.size > MAX_PHOTO_BYTES) {
        setFormError("Svaka fotografija mora biti manja od 5 MB.");
        continue;
      }
      accepted.push({
        id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        previewUrl: URL.createObjectURL(file),
        status: "pending",
      });
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
            ? { ...p, status: "done", publicUrl: presignData.publicUrl as string }
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
          customerFirst: firstName,
          customerLast: lastName,
          customerEmail: email || undefined,
          customerPhone: phone || undefined,
          description,
          notifyVia,
          photos: photos
            .filter((p) => p.status === "done" && p.publicUrl)
            .map((p) => ({ url: p.publicUrl })),
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
        } else if (data?.reason === "MISSING_CONTACT") {
          setFormError(
            "Unesite kontakt (e-poštu ili telefon) koji odgovara izabranom načinu obaveštavanja.",
          );
        } else if (data?.reason === "ORDER_NOT_FOUND") {
          setFormError("Porudžbina nije pronađena.");
        } else if (data?.reason === "ITEM_NOT_FOUND") {
          setFormError("Izabrani artikal nije pronađen u porudžbini.");
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
          Potvrdu i status pratite ovde ili preko izabranog kontakta.
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
            setOrderNumber(e.target.value);
            const next = orders.find((o) => o.number === e.target.value);
            setSku(next?.items[0]?.sku ?? "");
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
          onChange={(e) => setSku(e.target.value)}
          className="h-11 rounded-lg border border-input bg-white px-2.5 text-sm"
        >
          {selectedOrder?.items.map((item) => (
            <option key={item.sku} value={item.sku}>
              {item.name} ({item.qty} kom)
            </option>
          ))}
        </select>
        {fieldErrors.sku ? (
          <p className="text-xs text-destructive">{fieldErrors.sku}</p>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="customerFirst">Ime</Label>
          <Input
            id="customerFirst"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
            minLength={2}
            className="h-11 bg-white"
          />
          {fieldErrors.customerFirst ? (
            <p className="text-xs text-destructive">{fieldErrors.customerFirst}</p>
          ) : null}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="customerLast">Prezime</Label>
          <Input
            id="customerLast"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            required
            minLength={2}
            className="h-11 bg-white"
          />
          {fieldErrors.customerLast ? (
            <p className="text-xs text-destructive">{fieldErrors.customerLast}</p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-2">
        <Label>Način obaveštavanja o statusu</Label>
        <div className="flex gap-4 text-sm text-ink-700">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="notifyVia"
              value="EMAIL"
              checked={notifyVia === "EMAIL"}
              onChange={() => setNotifyVia("EMAIL")}
              className="size-4 accent-walnut"
            />
            E-poštom
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="notifyVia"
              value="PHONE"
              checked={notifyVia === "PHONE"}
              onChange={() => setNotifyVia("PHONE")}
              className="size-4 accent-walnut"
            />
            Telefonom
          </label>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="customerEmail">
            E-pošta {notifyVia === "EMAIL" ? "*" : ""}
          </Label>
          <Input
            id="customerEmail"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required={notifyVia === "EMAIL"}
            className="h-11 bg-white"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="customerPhone">
            Telefon {notifyVia === "PHONE" ? "*" : ""}
          </Label>
          <Input
            id="customerPhone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required={notifyVia === "PHONE"}
            minLength={8}
            className="h-11 bg-white"
          />
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="description">Opis problema</Label>
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
        <Label>Fotografije (do {MAX_PHOTOS}, JPG/PNG/WEBP, do 5 MB)</Label>
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
