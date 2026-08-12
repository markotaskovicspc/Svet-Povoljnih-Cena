"use client";

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  FileDown,
  FileSpreadsheet,
  Plus,
  Send,
  Trash2,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardTitle } from "@/components/admin/card";
import { Field } from "@/components/admin/field";
import {
  DISPATCH_SHIPMENT_METHODS,
  calculateDispatchLineTotals,
} from "@/lib/admin/dispatch-note";
import type {
  DispatchNoteDetail,
  DispatchNoteFormLine,
  DispatchNoteFormOptions,
  DispatchProductData,
} from "@/lib/admin/dispatch-note.server";

type EditableLine = DispatchNoteFormLine & {
  clientId: string;
  loading: boolean;
  error: string;
};

function localDate(value = new Date()) {
  const shifted = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 10);
}

function localDateTime(value = new Date()) {
  const shifted = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

function tomorrowLocalDateTime() {
  return localDateTime(new Date(Date.now() + 24 * 60 * 60 * 1_000));
}

function detailDateTime(value: string) {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : localDateTime(parsed);
}

function emptyProduct(): DispatchProductData {
  return {
    productId: "",
    sku: "",
    palletQty: null,
    subgroup: "",
    collection: "",
    shortDescription: "",
    shortName: "",
    attribute1: "",
    attribute2: "",
    attribute3: "",
    attribute4: "",
    color1: "",
    color2: "",
    unitPriceGross: 0,
    priceSource: "",
  };
}

function newLine(): EditableLine {
  return {
    ...emptyProduct(),
    clientId: crypto.randomUUID(),
    orderItemId: null,
    sourceOrderNumber: "",
    qty: 1,
    maxQty: null,
    loading: false,
    error: "",
  };
}

function initialLines(detail: DispatchNoteDetail | null) {
  if (!detail?.lines.length) return [newLine()];
  return detail.lines.map((line) => ({
    ...line,
    clientId: line.id ?? crypto.randomUUID(),
    loading: false,
    error: "",
  }));
}

function money(value: number, currency = "RSD") {
  return `${value.toLocaleString("sr-Latn-RS", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency}`;
}

function toIsoOrEmpty(value: string) {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function displayCompany(
  company:
    | DispatchNoteFormOptions["companies"][number]
    | null
    | undefined,
) {
  if (!company) return null;
  return [
    ["Naziv", company.companyName || company.label],
    ["PIB", company.pib],
    ["Matični broj", company.registrationNumber],
    ["Adresa", company.address],
    ["Mesto", company.city],
    ["Poštanski broj", company.postalCode],
    ["Telefon", company.phone],
    ["E-mail", company.email],
  ] as const;
}

export function DispatchNoteForm({
  options,
  detail = null,
  readOnly = false,
}: {
  options: DispatchNoteFormOptions;
  detail?: DispatchNoteDetail | null;
  readOnly?: boolean;
}) {
  const [issueDate, setIssueDate] = useState(
    () => detail?.issueDate || localDate(),
  );
  const [issuerCustomerId, setIssuerCustomerId] = useState(
    detail?.issuerCustomerId || options.defaultIssuerCustomerId,
  );
  const [receiverCustomerId, setReceiverCustomerId] = useState(
    detail?.receiverCustomerId || "",
  );
  const [sourceWarehouseId, setSourceWarehouseId] = useState(
    detail?.sourceWarehouseId || options.defaultWarehouseId,
  );
  const [destinationWarehouseId, setDestinationWarehouseId] = useState(
    detail?.destinationWarehouseId || "",
  );
  const [priceListId, setPriceListId] = useState(
    detail?.priceListId || options.priceLists[0]?.id || "",
  );
  const [showPrices, setShowPrices] = useState(detail?.showPrices ?? true);
  const [notes, setNotes] = useState(detail?.notes ?? "");
  const [importFrom, setImportFrom] = useState(
    detail?.importFrom || localDate(),
  );
  const [importTo, setImportTo] = useState(detail?.importTo || localDate());
  const [shipmentMethod, setShipmentMethod] = useState(
    detail?.shipmentMethod ?? 1,
  );
  const [carrierCustomerId, setCarrierCustomerId] = useState(
    detail?.carrierCustomerId ?? "",
  );
  const [licensePlate, setLicensePlate] = useState(
    detail?.licensePlate ?? "",
  );
  const [courierFirstName, setCourierFirstName] = useState(
    detail?.courierFirstName ?? "",
  );
  const [courierLastName, setCourierLastName] = useState(
    detail?.courierLastName ?? "",
  );
  const [courierIdNumber, setCourierIdNumber] = useState(
    detail?.courierIdNumber ?? "",
  );
  const [actualDispatchAt, setActualDispatchAt] = useState(
    () => (detail ? detailDateTime(detail.actualDispatchAt) : localDateTime()),
  );
  const [plannedDeliveryAt, setPlannedDeliveryAt] = useState(
    () =>
      detail
        ? detailDateTime(detail.plannedDeliveryAt)
        : tomorrowLocalDateTime(),
  );
  const [lines, setLines] = useState<EditableLine[]>(() =>
    initialLines(detail),
  );
  const [saving, setSaving] = useState(false);
  const [runningAction, setRunningAction] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  const internal =
    readOnly && detail
      ? detail.type === "INTERNAL"
      : Boolean(issuerCustomerId) && issuerCustomerId === receiverCustomerId;
  const issuer = readOnly && detail
    ? detail.issuer
    : options.companies.find((item) => item.id === issuerCustomerId) ?? null;
  const receiver = readOnly && detail
    ? detail.receiver
    : options.companies.find((item) => item.id === receiverCustomerId) ?? null;

  const totals = useMemo(
    () =>
      lines.reduce(
        (sum, line) => {
          const calculated = calculateDispatchLineTotals(
            Number(line.qty) || 0,
            internal ? 0 : Number(line.unitPriceGross) || 0,
          );
          sum.net += calculated.totalNet;
          sum.vat += calculated.totalVat;
          sum.gross += calculated.totalGross;
          return sum;
        },
        { net: 0, vat: 0, gross: 0 },
      ),
    [internal, lines],
  );

  const patchLine = (clientId: string, patch: Partial<EditableLine>) => {
    setLines((current) =>
      current.map((line) =>
        line.clientId === clientId ? { ...line, ...patch } : line,
      ),
    );
  };

  const fetchProduct = async (clientId: string, sku: string) => {
    const normalizedSku = sku.trim();
    if (!normalizedSku) {
      patchLine(clientId, { error: "Unesite šifru artikla." });
      return;
    }
    if (!internal && !priceListId) {
      patchLine(clientId, { error: "Prvo izaberite cenovnik." });
      return;
    }
    const duplicate = lines.some(
      (line) =>
        line.clientId !== clientId &&
        !line.orderItemId &&
        line.sku.trim().toLocaleUpperCase("sr-Latn-RS") ===
          normalizedSku.toLocaleUpperCase("sr-Latn-RS"),
    );
    if (duplicate) {
      patchLine(clientId, {
        error: "Ručna šifra može da postoji samo u jednom redu.",
      });
      return;
    }
    patchLine(clientId, { loading: true, error: "" });
    try {
      const params = new URLSearchParams({
        sku: normalizedSku,
        priceListId,
        internal: String(internal),
      });
      const response = await fetch(
        `/api/admin/erp/dispatch-notes/products?${params}`,
      );
      const payload = (await response.json().catch(() => null)) as
        | { product?: DispatchProductData; error?: string }
        | null;
      if (!response.ok || !payload?.product) {
        throw new Error(payload?.error ?? "Artikal nije učitan.");
      }
      patchLine(clientId, {
        ...payload.product,
        unitPriceGross: internal ? 0 : payload.product.unitPriceGross,
        priceSource: internal
          ? "Interni prenos bez cena"
          : payload.product.priceSource,
        loading: false,
        error: "",
      });
    } catch (error) {
      patchLine(clientId, {
        loading: false,
        error:
          error instanceof Error ? error.message : "Artikal nije učitan.",
      });
    }
  };

  const importOrders = async () => {
    setMessage(null);
    if (
      !receiverCustomerId ||
      !sourceWarehouseId ||
      !priceListId ||
      !importFrom ||
      !importTo
    ) {
      setMessage({
        ok: false,
        text: "Izaberite firmu primaoca, cenovnik, izvorni magacin i ceo period.",
      });
      return;
    }
    if (internal) {
      setMessage({
        ok: false,
        text: "Učitavanje VP/INO porudžbina nije dostupno za interni prenos.",
      });
      return;
    }
    if (
      lines.some((line) => line.productId) &&
      !window.confirm(
        "Učitavanje iz porudžbina zameniće trenutno unete stavke. Nastaviti?",
      )
    ) {
      return;
    }
    setRunningAction("import");
    try {
      const params = new URLSearchParams({
        receiverCustomerId,
        sourceWarehouseId,
        from: importFrom,
        to: importTo,
        priceListId,
      });
      if (detail?.id) params.set("excludeDispatchId", detail.id);
      const response = await fetch(
        `/api/admin/erp/dispatch-notes/orders?${params}`,
      );
      const payload = (await response.json().catch(() => null)) as
        | { lines?: DispatchNoteFormLine[]; error?: string }
        | null;
      if (!response.ok || !payload?.lines) {
        throw new Error(payload?.error ?? "Porudžbine nisu učitane.");
      }
      if (!payload.lines.length) {
        setMessage({
          ok: false,
          text: "U izabranom periodu nema neotpremljenih VP/INO stavki za ovu firmu i magacin.",
        });
        return;
      }
      setLines(
        payload.lines.map((line) => ({
          ...line,
          clientId: crypto.randomUUID(),
          loading: false,
          error: "",
        })),
      );
      setMessage({
        ok: true,
        text: `Učitano je ${payload.lines.length} stavki iz VP/INO porudžbina.`,
      });
    } catch (error) {
      setMessage({
        ok: false,
        text:
          error instanceof Error
            ? error.message
            : "Porudžbine nisu učitane.",
      });
    } finally {
      setRunningAction("");
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (readOnly) return;
    setMessage(null);
    if (!issuerCustomerId || !receiverCustomerId || !sourceWarehouseId) {
      setMessage({
        ok: false,
        text: "Izaberite obe firme i izvorni magacin.",
      });
      return;
    }
    if (internal && !destinationWarehouseId) {
      setMessage({
        ok: false,
        text: "Za interni prenos izaberite odredišni magacin.",
      });
      return;
    }
    if (!internal && !priceListId) {
      setMessage({ ok: false, text: "Izaberite cenovnik za otpremnicu." });
      return;
    }
    if (internal && lines.some((line) => line.orderItemId)) {
      setMessage({
        ok: false,
        text: "Interni prenos ne može koristiti stavke prodajnih porudžbina. Uklonite ih i dodajte šifre ručno.",
      });
      return;
    }
    const incomplete = lines.find(
      (line) =>
        !line.productId ||
        !line.sku ||
        line.qty < 1 ||
        line.loading ||
        (line.maxQty !== null && line.qty > line.maxQty),
    );
    if (incomplete) {
      setMessage({
        ok: false,
        text: "Učitajte svaki artikal i unesite dozvoljenu celobrojnu količinu.",
      });
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(
        detail
          ? `/api/admin/erp/dispatch-notes/${encodeURIComponent(detail.id)}`
          : "/api/admin/erp/dispatch-notes",
        {
          method: detail ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            issueDate,
            issuerCustomerId,
            receiverCustomerId,
            sourceWarehouseId,
            destinationWarehouseId: internal
              ? destinationWarehouseId
              : null,
            priceListId: internal ? null : priceListId,
            showPrices: internal ? false : showPrices,
            notes,
            importFrom,
            importTo,
            shipmentMethod,
            carrierCustomerId:
              shipmentMethod === 2 ? carrierCustomerId || null : null,
            licensePlate: shipmentMethod <= 3 ? licensePlate : "",
            courierFirstName: shipmentMethod >= 4 ? courierFirstName : "",
            courierLastName: shipmentMethod >= 4 ? courierLastName : "",
            courierIdNumber: shipmentMethod >= 4 ? courierIdNumber : "",
            actualDispatchAt: toIsoOrEmpty(actualDispatchAt),
            plannedDeliveryAt: toIsoOrEmpty(plannedDeliveryAt),
            lines: lines.map((line) => ({
              orderItemId: line.orderItemId,
              sku: line.sku,
              qty: Number(line.qty),
            })),
          }),
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | { note?: { id: string; number: string }; error?: string }
        | null;
      if (!response.ok || !payload?.note) {
        throw new Error(payload?.error ?? "Otpremnica nije sačuvana.");
      }
      window.location.assign(
        `/admin/erp/otpremnice/${encodeURIComponent(payload.note.id)}`,
      );
    } catch (error) {
      setMessage({
        ok: false,
        text:
          error instanceof Error
            ? error.message
            : "Otpremnica nije sačuvana.",
      });
    } finally {
      setSaving(false);
    }
  };

  const executeDetailAction = async (
    action: "delete" | "post" | "sef",
  ) => {
    if (!detail || runningAction) return;
    const confirmation =
      action === "delete"
        ? `Obrisati otpremnicu ${detail.number}?`
        : action === "post"
          ? `Proknjižiti otpremnicu ${detail.number} i skinuti robu sa lagera?`
          : `Poslati otpremnicu ${detail.number} u Sistem elektronskih otpremnica?`;
    if (!window.confirm(confirmation)) return;
    setRunningAction(action);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/admin/erp/dispatch-notes/${encodeURIComponent(detail.id)}${
          action === "delete" ? "" : `/${action}`
        }`,
        { method: action === "delete" ? "DELETE" : "POST" },
      );
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; message?: string; error?: string }
        | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? "Komanda nije izvršena.");
      }
      if (action === "delete") {
        window.location.assign("/admin/erp/otpremnice");
        return;
      }
      window.location.reload();
    } catch (error) {
      setMessage({
        ok: false,
        text:
          error instanceof Error ? error.message : "Komanda nije izvršena.",
      });
    } finally {
      setRunningAction("");
    }
  };

  const issuerFields = displayCompany(issuer);
  const receiverFields = displayCompany(receiver);

  return (
    <form className="space-y-6" onSubmit={submit}>
      {message ? (
        <p
          role={message.ok ? "status" : "alert"}
          className={
            message.ok
              ? "rounded-xl border border-success/20 bg-success/10 px-4 py-3 text-sm text-success"
              : "rounded-xl border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger"
          }
        >
          {message.text}
        </p>
      ) : null}

      {detail?.sefError ? (
        <p className="rounded-xl border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">
          Poslednja SEF greška: {detail.sefError}
        </p>
      ) : null}

      <Card>
        <CardTitle description="Obe firme se biraju iz baze kupaca. Interna otpremnica nastaje kada su izdavalac i primalac ista firma.">
          Uzglavlje otpremnice
        </CardTitle>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Broj otpremnice">
            <Input
              value={
                detail?.number ??
                "Broj porudžbine ili automatski zbirni broj"
              }
              readOnly
              disabled
            />
          </Field>
          <Field label="Datum otpremnice">
            <Input
              type="date"
              value={issueDate}
              disabled={readOnly}
              required
              onChange={(event) => setIssueDate(event.target.value)}
              aria-label="Datum otpremnice"
            />
          </Field>
          <Field label="Firma koja izdaje">
            <select
              value={issuerCustomerId}
              disabled={readOnly}
              required
              onChange={(event) => setIssuerCustomerId(event.target.value)}
              className="h-9 rounded-lg border border-input bg-surface px-3 text-sm disabled:opacity-60"
              aria-label="Firma koja izdaje"
            >
              <option value="">— izaberite firmu —</option>
              {options.companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.label}
                  {company.pib ? ` · PIB ${company.pib}` : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Magacin iz kog se izdaje">
            <select
              value={sourceWarehouseId}
              disabled={readOnly}
              required
              onChange={(event) => setSourceWarehouseId(event.target.value)}
              className="h-9 rounded-lg border border-input bg-surface px-3 text-sm disabled:opacity-60"
              aria-label="Magacin iz kog se izdaje"
            >
              <option value="">— izaberite magacin —</option>
              {options.warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.code} · {warehouse.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Firma koja prima">
            <select
              value={receiverCustomerId}
              disabled={readOnly}
              required
              onChange={(event) => setReceiverCustomerId(event.target.value)}
              className="h-9 rounded-lg border border-input bg-surface px-3 text-sm disabled:opacity-60"
              aria-label="Firma koja prima"
            >
              <option value="">— izaberite firmu —</option>
              {options.companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.label}
                  {company.pib ? ` · PIB ${company.pib}` : ""}
                </option>
              ))}
            </select>
          </Field>
          {!internal ? (
            <Field label="Cenovnik">
              <select
                value={priceListId}
                disabled={readOnly}
                required
                onChange={(event) => {
                  setPriceListId(event.target.value);
                  setLines([newLine()]);
                }}
                className="h-9 rounded-lg border border-input bg-surface px-3 text-sm disabled:opacity-60"
                aria-label="Cenovnik otpremnice"
              >
                <option value="">— izaberite cenovnik —</option>
                {options.priceLists.map((priceList) => (
                  <option key={priceList.id} value={priceList.id}>
                    {priceList.code} · {priceList.name} · {priceList.kind} · {priceList.currency}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          {internal ? (
            <Field label="Magacin firme koja prima">
              <select
                value={destinationWarehouseId}
                disabled={readOnly}
                required
                onChange={(event) =>
                  setDestinationWarehouseId(event.target.value)
                }
                className="h-9 rounded-lg border border-input bg-surface px-3 text-sm disabled:opacity-60"
                aria-label="Magacin firme koja prima"
              >
                <option value="">— izaberite odredišni magacin —</option>
                {options.warehouses
                  .filter((warehouse) => warehouse.id !== sourceWarehouseId)
                  .map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.code} · {warehouse.name}
                    </option>
                  ))}
              </select>
            </Field>
          ) : null}
          <Field
            label="Cene na štampi"
            hint={
              internal
                ? "Interni prenosi se uvek štampaju bez cena."
                : "Isključite za Ananas i druge otpremnice bez prikaza cena."
            }
          >
            <label className="flex h-9 items-center gap-2 rounded-lg border border-input px-3 text-sm">
              <input
                type="checkbox"
                checked={!internal && showPrices}
                disabled={readOnly || internal}
                onChange={(event) => setShowPrices(event.target.checked)}
                className="size-4 accent-ink-900"
                aria-label="Prikaži cene na štampi otpremnice"
              />
              {!internal && showPrices ? "Prikazuju se" : "Ne prikazuju se"}
            </label>
          </Field>
          {detail ? (
            <>
              <Field label="Proknjiženo">
                <label className="flex h-9 items-center gap-2 rounded-lg border border-input px-3 text-sm">
                  <input
                    type="checkbox"
                    checked={detail.status === "POSTED"}
                    readOnly
                    disabled
                    className="size-4"
                  />
                  {detail.postedAt ? "Da" : "Ne"}
                </label>
              </Field>
              <Field label="Poslato na SEF">
                <label className="flex h-9 items-center gap-2 rounded-lg border border-input px-3 text-sm">
                  <input
                    type="checkbox"
                    checked={Boolean(detail.sefSentAt)}
                    readOnly
                    disabled
                    className="size-4"
                  />
                  {detail.sefSentAt ? "Da" : "Ne"}
                </label>
              </Field>
            </>
          ) : null}
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          {[["Firma koja izdaje", issuerFields], ["Firma koja prima", receiverFields]].map(
            ([title, fields]) => (
              <div
                key={String(title)}
                className="grid gap-3 rounded-xl bg-muted-bg/50 p-4 sm:grid-cols-2"
              >
                <p className="sm:col-span-2 text-xs font-semibold uppercase tracking-[0.14em] text-ink-700">
                  {String(title)}
                </p>
                {(fields as ReturnType<typeof displayCompany>)?.map(
                  ([label, value]) => (
                    <div key={label}>
                      <p className="text-[11px] uppercase tracking-[0.1em] text-ink-500">
                        {label}
                      </p>
                      <p className="mt-1 text-sm text-ink-900">{value || "—"}</p>
                    </div>
                  ),
                ) ?? (
                  <p className="sm:col-span-2 text-sm text-ink-500">
                    Firma nije izabrana.
                  </p>
                )}
              </div>
            ),
          )}
        </div>

        <Field label="Napomena" className="mt-4">
          <textarea
            value={notes}
            disabled={readOnly}
            maxLength={2_000}
            onChange={(event) => setNotes(event.target.value)}
            className="min-h-24 rounded-lg border border-input bg-surface px-3 py-2 text-sm disabled:opacity-60"
            aria-label="Napomena otpremnice"
          />
        </Field>
      </Card>

      <Card>
        <CardTitle description="Za izabranog VP ili INO kupca učitavaju se samo još neotpremljene stavke rezervisane u izabranom magacinu.">
          Učitaj iz porudžbina
        </CardTitle>
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Period od">
            <Input
              type="date"
              value={importFrom}
              disabled={readOnly}
              onChange={(event) => setImportFrom(event.target.value)}
              aria-label="Period porudžbina od"
            />
          </Field>
          <Field label="Period do">
            <Input
              type="date"
              value={importTo}
              disabled={readOnly}
              onChange={(event) => setImportTo(event.target.value)}
              aria-label="Period porudžbina do"
            />
          </Field>
          {!readOnly ? (
            <Button
              type="button"
              variant="outline"
              disabled={runningAction === "import" || internal}
              onClick={() => void importOrders()}
            >
              {runningAction === "import"
                ? "Učitavanje…"
                : "Učitaj iz porudžbina"}
            </Button>
          ) : null}
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <CardTitle description="Šifra automatski popunjava matične podatke i cenu. Korisnik unosi samo šifru i količinu.">
            Stavke otpremnice
          </CardTitle>
          {!readOnly ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setLines((current) => [...current, newLine()])}
            >
              <Plus className="size-4" aria-hidden />
              Dodaj šifru
            </Button>
          ) : null}
        </div>

        <div className="overflow-x-auto rounded-xl border border-border/70">
          <table className="min-w-[2500px] text-sm">
            <thead className="bg-muted-bg/70 text-xs uppercase tracking-[0.08em] text-ink-500">
              <tr>
                <th className="w-64 px-3 py-3 text-left">Šifra artikla</th>
                <th className="w-40 px-3 py-3 text-left">Podgrupa</th>
                <th className="w-40 px-3 py-3 text-left">Kolekcija</th>
                <th className="w-64 px-3 py-3 text-left">Kratki opis</th>
                <th className="w-52 px-3 py-3 text-left">Kratki naziv</th>
                <th className="w-36 px-3 py-3 text-left">Atribut 1</th>
                <th className="w-36 px-3 py-3 text-left">Atribut 2</th>
                <th className="w-36 px-3 py-3 text-left">Atribut 3</th>
                <th className="w-36 px-3 py-3 text-left">Atribut 4</th>
                <th className="w-32 px-3 py-3 text-left">Boja 1</th>
                <th className="w-32 px-3 py-3 text-left">Boja 2</th>
                <th className="w-32 px-3 py-3 text-right">Kom/paleta</th>
                <th className="w-48 px-3 py-3 text-right">Cena</th>
                <th className="w-32 px-3 py-3 text-right">Količina</th>
                <th className="w-44 px-3 py-3 text-left">Porudžbina</th>
                {!readOnly ? <th className="w-16 px-3 py-3" /> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {lines.map((line, index) => (
                <tr key={line.clientId} className="align-top">
                  <td className="px-3 py-3">
                    <div className="flex gap-2">
                      <Input
                        value={line.sku}
                        disabled={readOnly || Boolean(line.orderItemId)}
                        required
                        onChange={(event) =>
                          patchLine(line.clientId, {
                            ...emptyProduct(),
                            sku: event.target.value,
                            qty: line.qty,
                            orderItemId: null,
                            sourceOrderNumber: "",
                            maxQty: null,
                            error: "",
                          })
                        }
                        onBlur={() => {
                          if (!readOnly && line.sku && !line.productId) {
                            void fetchProduct(line.clientId, line.sku);
                          }
                        }}
                        aria-label={`Šifra artikla red ${index + 1}`}
                      />
                      {!readOnly && !line.orderItemId ? (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={line.loading}
                          onClick={() =>
                            void fetchProduct(line.clientId, line.sku)
                          }
                        >
                          {line.loading ? "…" : "Učitaj"}
                        </Button>
                      ) : null}
                    </div>
                    {line.error ? (
                      <p className="mt-1 text-xs text-danger">{line.error}</p>
                    ) : null}
                  </td>
                  {[
                    line.subgroup,
                    line.collection,
                    line.shortDescription,
                    line.shortName,
                    line.attribute1,
                    line.attribute2,
                    line.attribute3,
                    line.attribute4,
                    line.color1,
                    line.color2,
                  ].map((value, valueIndex) => (
                    <td
                      key={valueIndex}
                      className="max-w-64 px-3 py-3 text-ink-800"
                      title={value || undefined}
                    >
                      <span className="line-clamp-3">{value || "—"}</span>
                    </td>
                  ))}
                  <td className="px-3 py-3 text-right text-ink-800">
                    {line.palletQty ?? "—"}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <span className="font-medium text-ink-900">
                      {internal
                        ? "—"
                        : money(line.unitPriceGross, detail?.currency ?? "RSD")}
                    </span>
                    <span className="mt-1 block text-xs text-ink-500">
                      {internal
                        ? "Interni prenos"
                        : line.priceSource || "Automatski"}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <Input
                      type="number"
                      min={1}
                      max={line.maxQty ?? undefined}
                      step={1}
                      value={line.qty}
                      disabled={readOnly}
                      required
                      onChange={(event) =>
                        patchLine(line.clientId, {
                          qty: Number(event.target.value),
                        })
                      }
                      aria-label={`Količina red ${index + 1}`}
                    />
                    {line.maxQty !== null ? (
                      <span className="mt-1 block text-xs text-ink-500">
                        Dostupno: {line.maxQty}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-3 text-ink-800">
                    {line.sourceOrderNumber || "Ručni unos"}
                  </td>
                  {!readOnly ? (
                    <td className="px-3 py-3">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() =>
                          setLines((current) =>
                            current.length === 1
                              ? [newLine()]
                              : current.filter(
                                  (item) =>
                                    item.clientId !== line.clientId,
                                ),
                          )
                        }
                        aria-label={`Ukloni red ${index + 1}`}
                      >
                        <Trash2 className="size-4 text-danger" aria-hidden />
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardTitle description="Ovi podaci su obavezni za zvanični API Sistema elektronskih otpremnica.">
          Podaci za SEF / eOtpremnicu
        </CardTitle>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Način otpreme">
            <select
              value={shipmentMethod}
              disabled={readOnly}
              onChange={(event) =>
                setShipmentMethod(Number(event.target.value))
              }
              className="h-9 rounded-lg border border-input bg-surface px-3 text-sm disabled:opacity-60"
              aria-label="Način otpreme za SEF"
            >
              {DISPATCH_SHIPMENT_METHODS.map((method) => (
                <option key={method.value} value={method.value}>
                  {method.value} · {method.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Stvarno vreme otpreme">
            <Input
              type="datetime-local"
              value={actualDispatchAt}
              disabled={readOnly}
              onChange={(event) => setActualDispatchAt(event.target.value)}
              aria-label="Stvarno vreme otpreme"
            />
          </Field>
          <Field label="Planirano vreme isporuke">
            <Input
              type="datetime-local"
              value={plannedDeliveryAt}
              disabled={readOnly}
              onChange={(event) => setPlannedDeliveryAt(event.target.value)}
              aria-label="Planirano vreme isporuke"
            />
          </Field>
        </div>
        {shipmentMethod <= 3 ? (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field
              label="Prevoznik"
              hint={
                shipmentMethod === 1
                  ? "Automatski: firma koja izdaje robu."
                  : shipmentMethod === 3
                    ? "Automatski: firma koja prima robu."
                    : "Izaberite prevoznika iz baze kupaca."
              }
            >
              {shipmentMethod === 2 && readOnly ? (
                <Input
                  value={detail?.carrier?.companyName ?? ""}
                  readOnly
                  disabled
                />
              ) : shipmentMethod === 2 ? (
                <select
                  value={carrierCustomerId}
                  disabled={readOnly}
                  onChange={(event) => setCarrierCustomerId(event.target.value)}
                  className="h-9 rounded-lg border border-input bg-surface px-3 text-sm disabled:opacity-60"
                  aria-label="Prevoznik"
                >
                  <option value="">— izaberite prevoznika —</option>
                  {options.companies.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.label}
                      {company.pib ? ` · PIB ${company.pib}` : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  value={
                    shipmentMethod === 1
                      ? issuer?.companyName ?? ""
                      : receiver?.companyName ?? ""
                  }
                  readOnly
                  disabled
                />
              )}
            </Field>
            <Field
              label="Registarska oznaka vozila"
              hint="Obavezna pre slanja na eOtpremnicu."
            >
              <Input
                value={licensePlate}
                disabled={readOnly}
                maxLength={30}
                onChange={(event) => setLicensePlate(event.target.value)}
                aria-label="Registarska oznaka vozila"
              />
            </Field>
          </div>
        ) : (
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <Field label="Ime kurira">
              <Input
                value={courierFirstName}
                disabled={readOnly}
                maxLength={100}
                onChange={(event) => setCourierFirstName(event.target.value)}
                aria-label="Ime kurira"
              />
            </Field>
            <Field label="Prezime kurira">
              <Input
                value={courierLastName}
                disabled={readOnly}
                maxLength={100}
                onChange={(event) => setCourierLastName(event.target.value)}
                aria-label="Prezime kurira"
              />
            </Field>
            <Field
              label="Broj lične karte kurira"
              hint="Obavezan pre slanja na eOtpremnicu."
            >
              <Input
                value={courierIdNumber}
                disabled={readOnly}
                maxLength={50}
                onChange={(event) => setCourierIdNumber(event.target.value)}
                aria-label="Broj lične karte kurira"
              />
            </Field>
          </div>
        )}
      </Card>

      <Card>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div className="grid grid-cols-2 gap-6 md:grid-cols-3">
            <div>
              <p className="text-xs uppercase tracking-[0.12em] text-ink-500">
                Vrednost bez PDV-a
              </p>
              <p className="mt-1 font-display text-xl text-ink-900">
                {money(totals.net)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.12em] text-ink-500">
                PDV
              </p>
              <p className="mt-1 font-display text-xl text-ink-900">
                {money(totals.vat)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.12em] text-ink-500">
                Vrednost sa PDV-om
              </p>
              <p className="mt-1 font-display text-xl text-ink-900">
                {money(totals.gross)}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/erp/otpremnice"
              className={buttonVariants({ variant: "outline" })}
            >
              Nazad na pregled
            </Link>
            {detail ? (
              <>
                <Link
                  href={`/api/admin/dispatch-notes/${encodeURIComponent(
                    detail.id,
                  )}/pdf`}
                  className={buttonVariants({ variant: "outline" })}
                >
                  <FileDown className="size-4" aria-hidden />
                  Štampaj PDF
                </Link>
                <Link
                  href={`/api/admin/dispatch-notes/${encodeURIComponent(
                    detail.id,
                  )}/excel`}
                  className={buttonVariants({ variant: "outline" })}
                >
                  <FileSpreadsheet className="size-4" aria-hidden />
                  Štampaj Excel
                </Link>
              </>
            ) : null}
            {readOnly && detail?.canEdit ? (
              <Link
                href={`/admin/erp/otpremnice/${encodeURIComponent(
                  detail.id,
                )}?mode=edit`}
                className={buttonVariants()}
              >
                Uredi
              </Link>
            ) : null}
            {!readOnly ? (
              <Button type="submit" disabled={saving || Boolean(runningAction)}>
                {saving
                  ? "Čuvanje…"
                  : detail
                    ? "Sačuvaj otpremnicu"
                    : "Kreiraj otpremnicu"}
              </Button>
            ) : null}
            {readOnly && detail?.canPost ? (
              <Button
                type="button"
                variant="outline"
                disabled={Boolean(runningAction)}
                onClick={() => void executeDetailAction("post")}
              >
                {runningAction === "post" ? "Knjiženje…" : "Proknjiži"}
              </Button>
            ) : null}
            {readOnly && detail?.canSendToSef ? (
              <Button
                type="button"
                variant="outline"
                disabled={Boolean(runningAction)}
                onClick={() => void executeDetailAction("sef")}
              >
                <Send className="size-4" aria-hidden />
                {runningAction === "sef" ? "Slanje…" : "Pošalji na SEF"}
              </Button>
            ) : null}
            {readOnly && detail?.canDelete ? (
              <Button
                type="button"
                variant="destructive"
                disabled={Boolean(runningAction)}
                onClick={() => void executeDetailAction("delete")}
              >
                {runningAction === "delete" ? "Brisanje…" : "Obriši"}
              </Button>
            ) : null}
          </div>
        </div>
      </Card>
    </form>
  );
}
