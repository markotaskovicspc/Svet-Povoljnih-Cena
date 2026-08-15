"use client";

import { useMemo, useState } from "react";
import { Field } from "@/components/admin/field";
import { Input } from "@/components/ui/input";
import { calculateInboundInvoiceAmounts } from "@/lib/admin/inbound-invoice";

export type InboundInvoicePurchaseOrderOption = {
  id: string;
  number: string;
  supplierId: string | null;
  supplierName: string | null;
  invoiceValueRsd: number;
  customsValueRsd: number;
  transportValueRsd: number;
};

type InitialInvoiceValues = {
  purchaseOrderId: string | null;
  supplierId: string | null;
  supplierName: string | null;
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
  const [invoiceValueRsd, setInvoiceValueRsd] = useState(
    moneyInput(
      initial.invoiceValueRsd ??
        (shouldUseOrderDefaults ? initialOrder?.invoiceValueRsd ?? 0 : 0),
    ),
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
  const totals = useMemo(
    () =>
      calculateInboundInvoiceAmounts({
        invoiceValueRsd: parseMoney(invoiceValueRsd),
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
    setInvoiceValueRsd(moneyInput(order?.invoiceValueRsd ?? 0));
    setCustomsValueRsd(moneyInput(order?.customsValueRsd ?? 0));
    setTransportValueRsd(moneyInput(order?.transportValueRsd ?? 0));
    setOtherRelatedCostsRsd("0");
  }

  return (
    <>
      <input type="hidden" name="supplierId" value={supplier.id} />
      <input type="hidden" name="exchangeRate" value="1" />
      <Field label="Naziv dobavljača" hint="Automatski se preuzima iz porudžbenice.">
        <Input value={supplier.name} readOnly aria-readonly="true" />
      </Field>
      <Field
        label="Veza sa dokumentom"
        hint="Prikazane su samo porudžbenice koje nisu povezane sa drugom ulaznom fakturom. Izbor popunjava dobavljača i prve tri vrednosti."
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
      <Field label="Tip fakture" hint="Sve ulazne fakture ovog toka su COGS.">
        <Input name="type" value="COGS" readOnly aria-readonly="true" />
      </Field>
      <Field label="Valuta" hint="Sve vrednosti fakture vode se u dinarima.">
        <Input name="currency" value="RSD" readOnly aria-readonly="true" />
      </Field>
      <Field label="Vrednost fakture u RSD">
        <Input
          name="invoiceValueRsd"
          type="number"
          min={0}
          step="0.01"
          required
          value={invoiceValueRsd}
          onChange={(event) => setInvoiceValueRsd(event.target.value)}
        />
      </Field>
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
