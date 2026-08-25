"use client";

import {
  useMemo,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardTitle } from "@/components/admin/card";
import { Field } from "@/components/admin/field";
import {
  SUPPLIER_ALLOCATION,
  calculateSalesLineTotals,
} from "@/lib/admin/sales-order";
import type {
  SalesOrderDetail,
  SalesOrderFormLine,
  SalesOrderFormOptions,
  SalesOrderProductData,
} from "@/lib/admin/sales-order.server";

type EditableLine = SalesOrderFormLine & {
  clientId: string;
  loading: boolean;
  error: string;
};

const subscribeToClientRuntime = () => () => {};

function useClientReady() {
  return useSyncExternalStore(
    subscribeToClientRuntime,
    () => true,
    () => false,
  );
}

function emptyProduct(): SalesOrderProductData {
  return {
    productId: "",
    sku: "",
    name: "",
    articleStatus: "",
    supplier: "",
    supplierId: null,
    category: "",
    group: "",
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
    unitPrice: null,
    priceSource: "",
    defaultAllocation: "",
    supplierAllocationAllowed: false,
    warehouseAvailability: {},
  };
}

function newLine(): EditableLine {
  return {
    ...emptyProduct(),
    clientId: crypto.randomUUID(),
    qty: 1,
    allocation: "",
    loading: false,
    error: "",
  };
}

function initialLines(detail: SalesOrderDetail | null): EditableLine[] {
  if (!detail?.lines.length) return [newLine()];
  return detail.lines.map((line) => ({
    ...line,
    clientId: line.id ?? crypto.randomUUID(),
    loading: false,
    error: "",
  }));
}

function money(value: number, currency: string) {
  const [whole, fraction] = value.toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${grouped},${fraction} ${currency}`;
}

function metadataFields(line: EditableLine) {
  return [
    ["Pun naziv", line.name],
    ["Dobavljač", line.supplier],
    ["Status artikla", line.articleStatus],
    ["Kategorija", line.category],
    ["Grupa", line.group],
    ["Podgrupa", line.subgroup],
    ["Kolekcija", line.collection],
    ["Kratki naziv", line.shortName],
    ["Kratki opis", line.shortDescription],
    ["Atribut 1", line.attribute1],
    ["Atribut 2", line.attribute2],
    ["Atribut 3", line.attribute3],
    ["Atribut 4", line.attribute4],
    ["Boja 1", line.color1],
    ["Boja 2", line.color2],
  ] as const;
}

export function SalesOrderForm({
  options,
  detail = null,
  readOnly = false,
  initialChannel = "VP",
}: {
  options: SalesOrderFormOptions;
  detail?: SalesOrderDetail | null;
  readOnly?: boolean;
  initialChannel?: "MP" | "VP" | "INO";
}) {
  const clientReady = useClientReady();
  const [channel, setChannel] = useState<
    "WEB" | "ANANAS" | "MP" | "VP" | "INO"
  >(
    detail?.channel === "WEB" ||
      detail?.channel === "ANANAS" ||
      detail?.channel === "MP" ||
      detail?.channel === "INO" ||
      detail?.channel === "VP"
      ? detail.channel
      : initialChannel,
  );
  const [customerId, setCustomerId] = useState(detail?.customerId ?? "");
  const [priceListId, setPriceListId] = useState(detail?.priceListId ?? "");
  const [status, setStatus] = useState(detail?.status ?? "KREIRANO");
  const [paid, setPaid] = useState(detail?.paid ?? false);
  const [sefAccepted, setSefAccepted] = useState(detail?.sefAccepted ?? false);
  const [lines, setLines] = useState<EditableLine[]>(() => initialLines(detail));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  const selectedCustomer =
    options.customers.find((customer) => customer.id === customerId) ?? null;
  const customer =
    selectedCustomer ??
    (detail
      ? {
          id: "",
          ...detail.customerSnapshot,
        }
      : null);
  const selectedPriceList =
    options.priceLists.find((priceList) => priceList.id === priceListId) ?? null;
  const currency = selectedPriceList?.currency ?? detail?.currency ?? "RSD";
  const totals = useMemo(
    () =>
      lines.reduce(
        (sum, line) => {
          const calculated = calculateSalesLineTotals(
            Number(line.qty) || 0,
            Number(line.unitPrice) || 0,
          );
          sum.net += calculated.totalNet;
          sum.gross += calculated.totalGross;
          return sum;
        },
        { net: 0, gross: 0 },
      ),
    [lines],
  );

  const patchLine = (clientId: string, patch: Partial<EditableLine>) => {
    setLines((current) =>
      current.map((line) =>
        line.clientId === clientId ? { ...line, ...patch } : line,
      ),
    );
  };

  const fetchProduct = async (
    clientId: string,
    sku: string,
    nextPriceListId = priceListId,
    preserveAllocation = false,
  ) => {
    const normalizedSku = sku.trim();
    if (!normalizedSku) {
      patchLine(clientId, { error: "Unesite šifru artikla." });
      return;
    }
    if (!nextPriceListId) {
      patchLine(clientId, { error: "Prvo izaberite cenovnik." });
      return;
    }
    if (
      lines.some(
        (line) =>
          line.clientId !== clientId &&
          line.sku.trim().toLocaleUpperCase("sr-Latn-RS") ===
            normalizedSku.toLocaleUpperCase("sr-Latn-RS"),
      )
    ) {
      patchLine(clientId, {
        error: "Svaka šifra može da postoji samo u jednom redu.",
      });
      return;
    }
    patchLine(clientId, { loading: true, error: "" });
    try {
      const params = new URLSearchParams({
        sku: normalizedSku,
        priceListId: nextPriceListId,
      });
      const response = await fetch(
        `/api/admin/erp/sales-orders/products?${params}`,
      );
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; product?: SalesOrderProductData; error?: string }
        | null;
      if (!response.ok || !payload?.product) {
        throw new Error(payload?.error ?? "Artikal nije učitan.");
      }
      setLines((current) =>
        current.map((line) =>
          line.clientId === clientId
            ? {
                ...line,
                ...payload.product!,
                sku: payload.product!.sku,
                allocation:
                  preserveAllocation && line.allocation
                    ? line.allocation
                    : payload.product!.defaultAllocation,
                loading: false,
                error: "",
              }
            : line,
        ),
      );
    } catch (error) {
      patchLine(clientId, {
        loading: false,
        error:
          error instanceof Error ? error.message : "Artikal nije učitan.",
      });
    }
  };

  const changePriceList = (nextPriceListId: string) => {
    setPriceListId(nextPriceListId);
    for (const line of lines) {
      if (line.productId && line.sku) {
        void fetchProduct(line.clientId, line.sku, nextPriceListId, true);
      }
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (readOnly) return;
    setMessage(null);
    if (!customerId) {
      setMessage({ ok: false, text: "Izaberite kupca." });
      return;
    }
    if (!priceListId) {
      setMessage({ ok: false, text: "Izaberite cenovnik." });
      return;
    }
    const incomplete = lines.find(
      (line) =>
        !line.productId ||
        !line.sku ||
        line.unitPrice === null ||
        !line.allocation ||
        line.loading ||
        line.qty < 1,
    );
    if (incomplete) {
      setMessage({
        ok: false,
        text: "Sačekajte učitavanje i popunite svaki artikal, količinu, MP cenu i magacin.",
      });
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(
        detail
          ? `/api/admin/erp/sales-orders/${encodeURIComponent(detail.id)}`
          : "/api/admin/erp/sales-orders",
        {
          method: detail ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            channel,
            customerId,
            priceListId,
            status,
            paid,
            sefAccepted,
            lines: lines.map((line) => ({
              sku: line.sku,
              qty: Number(line.qty),
              unitPrice: Number(line.unitPrice),
              allocation: line.allocation,
            })),
          }),
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            order?: { id: string; number: string };
            error?: string;
          }
        | null;
      if (!response.ok || !payload?.order) {
        throw new Error(payload?.error ?? "Porudžbina nije sačuvana.");
      }
      setMessage({
        ok: true,
        text: `Porudžbina ${payload.order.number} je sačuvana.`,
      });
      window.location.assign(
        `/admin/erp/prodajni-nalozi/${encodeURIComponent(payload.order.id)}`,
      );
    } catch (error) {
      setMessage({
        ok: false,
        text:
          error instanceof Error
            ? error.message
            : "Porudžbina nije sačuvana.",
      });
    } finally {
      setSaving(false);
    }
  };

  const deleteOrder = async () => {
    if (!detail || deleting) return;
    if (
      !window.confirm(
        `Obrisati porudžbinu ${detail.number}? Ova akcija je dozvoljena samo za neobrađenu i neplaćenu MP/VP/INO porudžbinu.`,
      )
    ) {
      return;
    }
    setDeleting(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/admin/erp/sales-orders/${encodeURIComponent(detail.id)}`,
        { method: "DELETE" },
      );
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? "Porudžbina nije obrisana.");
      }
      window.location.assign("/admin/erp/prodajni-nalozi");
    } catch (error) {
      setMessage({
        ok: false,
        text:
          error instanceof Error
            ? error.message
            : "Porudžbina nije obrisana.",
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <form
      className="space-y-6"
      onSubmit={submit}
      inert={!clientReady}
      aria-busy={!clientReady}
      data-client-ready={clientReady ? "true" : "false"}
    >
      <fieldset className="contents" disabled={!clientReady}>
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

      {readOnly && detail && !detail.canEdit ? (
        <p className="rounded-xl border border-warning/20 bg-warning/10 px-4 py-3 text-sm text-warning">
          Ova porudžbina je samo za pregled: WEB/Ananas porudžbine i već
          dokumentovane, poslate ili završene MP/VP/INO porudžbine ne menjaju se
          kroz ručni obrazac.
        </p>
      ) : null}

      <Card>
        <CardTitle description="Broj se dodeljuje automatski; podaci kupca se preuzimaju iz baze kupaca.">
          Porudžbina i kupac
        </CardTitle>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Broj porudžbine">
            <Input
              value={detail?.number ?? "Automatski pri čuvanju"}
              readOnly
              disabled
            />
          </Field>
          <Field label="Vrsta porudžbine">
            <select
              value={channel}
              disabled={readOnly || Boolean(detail)}
              onChange={(event) =>
                setChannel(
                  event.target.value === "INO"
                    ? "INO"
                    : event.target.value === "MP"
                      ? "MP"
                      : "VP",
                )
              }
              className="h-9 rounded-lg border border-input bg-surface px-3 text-sm disabled:opacity-60"
              aria-label="Vrsta porudžbine"
            >
              {channel === "WEB" || channel === "ANANAS" ? (
                <option value={channel}>{channel}</option>
              ) : null}
              <option value="MP">MP · maloprodaja</option>
              <option value="VP">VP · veleprodaja</option>
              <option value="INO">INO · izvoz</option>
            </select>
          </Field>
          <Field label="Kupac">
            <select
              value={customerId}
              disabled={readOnly}
              required
              onChange={(event) => setCustomerId(event.target.value)}
              className="h-9 rounded-lg border border-input bg-surface px-3 text-sm disabled:opacity-60"
              aria-label="Kupac"
            >
              <option value="">— izaberite kupca —</option>
              {options.customers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                  {item.pib ? ` · PIB ${item.pib}` : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Cenovnik">
            <select
              value={priceListId}
              disabled={readOnly}
              required
              onChange={(event) => changePriceList(event.target.value)}
              className="h-9 rounded-lg border border-input bg-surface px-3 text-sm disabled:opacity-60"
              aria-label="Cenovnik"
            >
              <option value="">— izaberite cenovnik —</option>
              {options.priceLists.map((priceList) => (
                <option key={priceList.id} value={priceList.id}>
                  {priceList.code} · {priceList.name} · {priceList.kind} ·{" "}
                  {priceList.currency}
                </option>
              ))}
            </select>
          </Field>
          {detail ? (
            <Field label="Status porudžbine">
              <select
                value={status}
                disabled={readOnly}
                onChange={(event) => setStatus(event.target.value)}
                className="h-9 rounded-lg border border-input bg-surface px-3 text-sm disabled:opacity-60"
                aria-label="Status porudžbine"
              >
                <option value="KREIRANO">Kreirano</option>
                <option value="POTVRDJENO">Potvrđeno</option>
                <option value="U_PRIPREMI">U pripremi</option>
                <option value="SPREMNO_ZA_ISPORUKU">
                  Spremno za isporuku
                </option>
              </select>
            </Field>
          ) : null}
          <Field label="Plaćeno">
            <label className="flex h-9 items-center gap-2 rounded-lg border border-input px-3 text-sm">
              <input
                type="checkbox"
                checked={paid}
                disabled={readOnly}
                onChange={(event) => setPaid(event.target.checked)}
                className="size-4 accent-ink-900"
              />
              {paid ? "Da" : "Ne"}
            </label>
          </Field>
          <Field label="Prihvaćeno na SEF-u">
            <label className="flex h-9 items-center gap-2 rounded-lg border border-input px-3 text-sm">
              <input
                type="checkbox"
                checked={sefAccepted}
                disabled={readOnly}
                onChange={(event) => setSefAccepted(event.target.checked)}
                className="size-4 accent-ink-900"
              />
              {sefAccepted ? "Da" : "Ne"}
            </label>
          </Field>
          {detail ? (
            <>
              <Field label="Fiskalizovano">
                <Input value={detail.fiscalized ? "Da" : "Ne"} readOnly disabled />
              </Field>
              <Field label="Fakturisano">
                <Input value={detail.invoiced ? "Da" : "Ne"} readOnly disabled />
              </Field>
            </>
          ) : null}
        </div>

        <div className="mt-5 grid gap-3 rounded-xl bg-muted-bg/50 p-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["Ime / firma", customer?.label],
            ["PIB", customer?.pib],
            ["Adresa", customer?.address],
            ["Mesto", customer?.city],
            ["Poštanski broj", customer?.postalCode],
            ["Telefon", customer?.phone],
            ["E-mail", customer?.email],
            ["Država", customer?.country],
          ].map(([label, value]) => (
            <div key={label}>
              <p className="text-xs uppercase tracking-[0.12em] text-ink-500">
                {label}
              </p>
              <p className="mt-1 text-sm text-ink-900">{value || "—"}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <CardTitle description="Šifra učitava matične podatke i cenu; količina, MP cena i magacin ostaju kontrolisano promenljivi.">
            Artikli porudžbine
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

        <div className="space-y-4">
          {lines.map((line, index) => {
            const lineTotals = calculateSalesLineTotals(
              Number(line.qty) || 0,
              Number(line.unitPrice) || 0,
            );
            return (
              <div
                key={line.clientId}
                className="rounded-xl border border-border/70 p-4"
              >
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="font-medium text-ink-900">
                      Red {index + 1}
                      {line.name ? ` · ${line.name}` : ""}
                    </h3>
                    {line.shortName && line.shortName !== line.name ? (
                      <p className="text-xs text-ink-500">
                        Kratki naziv: {line.shortName}
                      </p>
                    ) : null}
                  </div>
                  {!readOnly && lines.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setLines((current) =>
                          current.filter(
                            (item) => item.clientId !== line.clientId,
                          ),
                        )
                      }
                      aria-label={`Ukloni red ${index + 1}`}
                    >
                      <Trash2 className="size-4 text-danger" aria-hidden />
                    </Button>
                  ) : null}
                </div>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                  <Field label="Šifra artikla" error={line.error || undefined}>
                    <div className="flex gap-2">
                      <Input
                        value={line.sku}
                        disabled={readOnly}
                        required
                        onChange={(event) =>
                          patchLine(line.clientId, {
                            ...emptyProduct(),
                            sku: event.target.value,
                            qty: line.qty,
                            allocation: "",
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
                      {!readOnly ? (
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
                  </Field>
                  <Field label="Količina">
                    <Input
                      type="number"
                      min={1}
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
                  </Field>
                  <Field label={`MP cena (${currency})`} hint={line.priceSource}>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={line.unitPrice ?? ""}
                      disabled={readOnly}
                      required
                      onChange={(event) =>
                        patchLine(line.clientId, {
                          unitPrice:
                            event.target.value === ""
                              ? null
                              : Number(event.target.value),
                          priceSource: "Ručna izmena",
                        })
                      }
                      aria-label={`MP cena red ${index + 1}`}
                    />
                  </Field>
                  <Field label="Ukupno bez PDV-a">
                    <Input
                      value={money(lineTotals.totalNet, currency)}
                      readOnly
                      disabled
                    />
                  </Field>
                  <Field label="Ukupno sa PDV-om">
                    <Input
                      value={money(lineTotals.totalGross, currency)}
                      readOnly
                      disabled
                    />
                  </Field>
                  <Field label="Magacin" className="md:col-span-2">
                    <select
                      value={line.allocation}
                      disabled={readOnly || !line.productId}
                      required
                      onChange={(event) =>
                        patchLine(line.clientId, {
                          allocation: event.target.value,
                        })
                      }
                      className="h-9 rounded-lg border border-input bg-surface px-3 text-sm disabled:opacity-60"
                      aria-label={`Magacin red ${index + 1}`}
                    >
                      <option value="">— izaberite magacin —</option>
                      {options.warehouses.map((warehouse) => (
                        <option key={warehouse.id} value={warehouse.id}>
                          {warehouse.code} · {warehouse.name}
                          {warehouse.isDefault ? " · DC" : ""}
                          {line.productId
                            ? ` · raspoloživo ${line.warehouseAvailability[warehouse.id] ?? 0}`
                            : ""}
                        </option>
                      ))}
                      {line.supplierAllocationAllowed ? (
                        <option value={SUPPLIER_ALLOCATION}>
                          Kod dobavljača · {line.supplier || "dobavljač"}
                        </option>
                      ) : null}
                    </select>
                  </Field>
                </div>

                {line.productId ? (
                  <div className="mt-4 grid gap-3 rounded-lg bg-muted-bg/50 p-3 sm:grid-cols-2 lg:grid-cols-4">
                    {metadataFields(line).map(([label, value]) => (
                      <div key={label}>
                        <p className="text-[11px] uppercase tracking-[0.1em] text-ink-500">
                          {label}
                        </p>
                        <p className="mt-1 text-sm text-ink-800">
                          {value || "—"}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="grid grid-cols-2 gap-8">
            <div>
              <p className="text-xs uppercase tracking-[0.12em] text-ink-500">
                Ukupno bez PDV-a
              </p>
              <p className="mt-1 font-display text-xl text-ink-900">
                {money(totals.net, currency)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.12em] text-ink-500">
                Ukupno sa PDV-om
              </p>
              <p className="mt-1 font-display text-xl text-ink-900">
                {money(totals.gross, currency)}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/erp/prodajni-nalozi"
              onClick={(event) => {
                event.preventDefault();
                window.location.assign(event.currentTarget.href);
              }}
              className={buttonVariants({ variant: "outline" })}
            >
              Nazad na pregled
            </Link>
            {readOnly && detail?.canEdit ? (
              <Link
                href={`/admin/erp/prodajni-nalozi/${encodeURIComponent(detail.id)}?mode=edit`}
                onClick={(event) => {
                  event.preventDefault();
                  window.location.assign(event.currentTarget.href);
                }}
                className={buttonVariants()}
              >
                Uredi
              </Link>
            ) : null}
            {!readOnly ? (
              <Button type="submit" disabled={saving || deleting}>
                {saving
                  ? "Čuvanje…"
                  : detail
                    ? "Sačuvaj porudžbinu"
                    : "Kreiraj porudžbinu"}
              </Button>
            ) : null}
            {detail?.canDelete ? (
              <Button
                type="button"
                variant="destructive"
                disabled={saving || deleting}
                onClick={deleteOrder}
              >
                {deleting ? "Brisanje…" : "Obriši"}
              </Button>
            ) : null}
          </div>
        </div>
      </Card>
      </fieldset>
    </form>
  );
}
