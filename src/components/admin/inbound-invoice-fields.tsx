"use client";

import { useMemo, useState } from "react";
import { Field } from "@/components/admin/field";
import { Input } from "@/components/ui/input";
import {
  calculateInboundInvoiceAmounts,
  calculateInboundInvoiceValueRsd,
  type InboundInvoiceCurrency,
} from "@/lib/admin/inbound-invoice";

export type InboundInvoicePurchaseOrderOption = {
  id: string;
  number: string;
  supplierId: string | null;
  supplierName: string | null;
  currency: InboundInvoiceCurrency;
  exchangeRate: number;
  invoiceValue: number;
  invoiceValueRsd: number;
  customsValueRsd: number;
  transportValueRsd: number;
};

type InitialInvoiceValues = {
  purchaseOrderId: string | null;
  supplierId: string | null;
  supplierName: string | null;
  currency: InboundInvoiceCurrency;
  exchangeRate: number;
  invoiceValue: number;
  invoiceValueRsd: number | null;
  customsValueRsd: number | null;
  transportValueRsd: number | null;
  otherRelatedCostsRsd: number | null;
  legacyNetValue: number;
};

function moneyInput(value: number) {
  return String(Math.round((value + Number.EPSILON) * 100) / 100);
}

function parseMoney(value: string) {
  const amount = Number(value.replace(",", "."));
  return Number.isFinite(amount) && amount >= 0 ? amount : 0;
}

export function InboundInvoiceFields({
  purchaseOrders,
  initial,
  editing,
}: {
  purchaseOrders: InboundInvoicePurchaseOrderOption[];
  initial: InitialInvoiceValues;
  editing: boolean;
}) {
  const initialOrder = purchaseOrders.find(
    (order) => order.id === initial.purchaseOrderId,
  );
  const hasSavedBreakdown = initial.invoiceValueRsd != null;
  const shouldPrepareLegacyForEditing =
    editing && !hasSavedBreakdown && initial.legacyNetValue > 0 && initialOrder;
  const shouldUseOrderDefaults =
    Boolean(initialOrder) &&
    !hasSavedBreakdown &&
    (initial.legacyNetValue === 0 || shouldPrepareLegacyForEditing);

  const [purchaseOrderId, setPurchaseOrderId] = useState(
    initial.purchaseOrderId ?? "",
  );
  const [supplier, setSupplier] = useState({
    id: initial.supplierId ?? initialOrder?.supplierId ?? "",
    name: initial.supplierName ?? initialOrder?.supplierName ?? "",
  });
  const [invoiceValue, setInvoiceValue] = useState(
    moneyInput(hasSavedBreakdown
      ? initial.invoiceValueRsd!
      : shouldUseOrderDefaults ? initialOrder?.invoiceValueRsd ?? 0
      : calculateInboundInvoiceValueRsd({
          invoiceValue: initial.invoiceValue, currency: initial.currency,
          exchangeRate: initial.exchangeRate || 1,
        })),
  );
  const [customsValueRsd, setCustomsValueRsd] = useState(
    moneyInput(
      initial.customsValueRsd ??
        (shouldUseOrderDefaults ? initialOrder?.customsValueRsd ?? 0 : 0),
    ),
  );
  const [transportValueRsd, setTransportValueRsd] = useState(
    moneyInput(
      initial.transportValueRsd ??
        (shouldUseOrderDefaults ? initialOrder?.transportValueRsd ?? 0 : 0),
    ),
  );
  const [otherRelatedCostsRsd, setOtherRelatedCostsRsd] = useState(
    moneyInput(initial.otherRelatedCostsRsd ?? 0),
  );
  const invoiceValueRsd = parseMoney(invoiceValue);
  const selectedOrder = purchaseOrders.find((order) => order.id === purchaseOrderId);
  const totals = useMemo(
    () =>
      calculateInboundInvoiceAmounts({
        invoiceValueRsd,
        customsValueRsd: parseMoney(customsValueRsd),
        transportValueRsd: parseMoney(transportValueRsd),
        otherRelatedCostsRsd: parseMoney(otherRelatedCostsRsd),
      }),
    [
      customsValueRsd,
      invoiceValueRsd,
      otherRelatedCostsRsd,
      transportValueRsd,
    ],
  );

  function selectPurchaseOrder(id: string) {
    setPurchaseOrderId(id);
    const order = purchaseOrders.find((candidate) => candidate.id === id);
    setSupplier({
      id: order?.supplierId ?? "",
      name: order?.supplierName ?? "",
    });
    setInvoiceValue(moneyInput(order?.invoiceValueRsd ?? 0));
    setCustomsValueRsd(moneyInput(order?.customsValueRsd ?? 0));
    setTransportValueRsd(moneyInput(order?.transportValueRsd ?? 0));
    setOtherRelatedCostsRsd("0");
  }

  return (
    <>
      <input type="hidden" name="supplierId" value={supplier.id} />
      <Field label="Naziv dobavljača" hint="Automatski se preuzima iz porudžbenice.">
        <Input value={supplier.name} readOnly aria-readonly="true" />
      </Field>
      <Field
        label="Veza sa dokumentom"
        hint="Prikazane su samo porudžbenice koje nisu povezane sa drugom prijemnicom. Izbor popunjava dobavljača i prve tri vrednosti."
      >
        <select
          name="purchaseOrderId"
          required
          value={purchaseOrderId}
          onChange={(event) => selectPurchaseOrder(event.target.value)}
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
        >
          <option value="">— izaberite porudžbenicu —</option>
          {purchaseOrders.map((order) => (
            <option key={order.id} value={order.id}>
              {order.number} · {order.supplierName ?? "bez dobavljača"}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Tip prijemnice" hint="Sve prijemnice ovog toka su COGS.">
        <Input name="type" value="COGS" readOnly aria-readonly="true" />
      </Field>
      <Field label="Valuta prijemnice" hint="Prijemnica se vodi u dinarima. Nabavne cene ostaju u valuti porudžbenice.">
        <Input name="currency" value="RSD" readOnly aria-readonly="true" />
      </Field>
      <input type="hidden" name="exchangeRate" value="1" />
      <input type="hidden" name="exchangeRateSource" value="RATE" />
      <input type="hidden" name="invoiceValueRsd" value={invoiceValueRsd} />
      <Field label="Vrednost robe u RSD" hint="Unesite konačan dinarski iznos robe, bez carine, transporta i ostalih troškova. Predlog iz porudžbenice proverite prema dokumentaciji.">
        <Input name="invoiceValue" type="number" min={0} step="0.01" required
          value={invoiceValue} onChange={(event) => setInvoiceValue(event.target.value)} />
      </Field>
      {selectedOrder ? (
        <Field label="Nabavna vrednost iz porudžbenice" hint="Izvorne cene se ne menjaju pri čuvanju prijemnice.">
          <Input value={`${selectedOrder.invoiceValue.toLocaleString("sr-Latn-RS", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${selectedOrder.currency}`} readOnly aria-readonly="true" />
        </Field>
      ) : null}
      <Field label="Vrednost carine u RSD">
        <Input
          name="customsValueRsd"
          type="number"
          min={0}
          step="0.01"
          required
          value={customsValueRsd}
          onChange={(event) => setCustomsValueRsd(event.target.value)}
        />
      </Field>
      <Field label="Vrednost transporta u RSD">
        <Input
          name="transportValueRsd"
          type="number"
          min={0}
          step="0.01"
          required
          value={transportValueRsd}
          onChange={(event) => setTransportValueRsd(event.target.value)}
        />
      </Field>
      <Field label="Vrednost ostalih vezanih troškova u RSD">
        <Input
          name="otherRelatedCostsRsd"
          type="number"
          min={0}
          step="0.01"
          required
          value={otherRelatedCostsRsd}
          onChange={(event) => setOtherRelatedCostsRsd(event.target.value)}
        />
      </Field>
      <input type="hidden" name="otherCostsAllocationBasis" value="VOLUME" />
      <Field
        label="Raspodela vezanih troškova"
        hint="Transport i ostali vezani troškovi raspoređuju se po zapremini artikla."
      >
        <Input value="Prema zapremini artikla" readOnly aria-readonly="true" />
      </Field>
      <Field
        label="Ukupno bez PDV-a"
        hint="Automatski zbir fakture, carine, transporta i ostalih troškova."
      >
        <Input
          name="netValue"
          type="number"
          value={moneyInput(totals.netValue)}
          readOnly
          aria-readonly="true"
        />
      </Field>
      <Field label="PDV (20%)" hint="Automatski obračunato iz vrednosti bez PDV-a.">
        <Input
          name="vatValue"
          type="number"
          value={moneyInput(totals.vatValue)}
          readOnly
          aria-readonly="true"
        />
      </Field>
      <Field label="Ukupno sa PDV-om">
        <Input
          name="grossValue"
          type="number"
          value={moneyInput(totals.grossValue)}
          readOnly
          aria-readonly="true"
        />
      </Field>
    </>
  );
}
