"use client";

import { useMemo, useState } from "react";
import { ReceiptText, RotateCcw } from "lucide-react";
import type { AdminActionState } from "@/lib/admin/action-state";
import { AdminActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type AdminFormAction = (
  state: AdminActionState,
  formData: FormData,
) => Promise<AdminActionState>;

type FiscalizationRow = {
  id: string;
  orderNumber: string;
  fiscalReceiptNumber: string;
  issuedAt: string;
  customerName: string;
  pib: string;
  priceList: string;
  address: string;
  city: string;
  postalCode: string;
  phone: string;
  email: string;
  sku: string;
  supplierName: string;
  categoryName: string;
  groupName: string;
  subgroupName: string;
  collectionName: string;
  shortDescription: string;
  shortName: string;
  attribute1: string;
  attribute2: string;
  attribute3: string;
  attribute4: string;
  color1: string;
  color2: string;
  qty: number;
  unitPriceGross: string;
  totalNet: string;
  totalGross: string;
  warehouseName: string;
  refunded: boolean;
};

type ManualOrder = {
  id: string;
  number: string;
  customer: string;
  city: string;
  paymentMethod: string;
  lines: {
    id: string;
    sku: string;
    name: string;
    orderedQty: number;
    remainingQty: number;
    unitPriceGross: string;
  }[];
};

type WarehouseOption = { id: string; code: string; name: string; isDefault: boolean };

const columns: { key: keyof FiscalizationRow; label: string; align?: "right" | "center" }[] = [
  { key: "orderNumber", label: "Broj porudžbine" },
  { key: "customerName", label: "Kupac" },
  { key: "pib", label: "PIB" },
  { key: "priceList", label: "Cenovnik" },
  { key: "address", label: "Adresa" },
  { key: "city", label: "Mesto" },
  { key: "postalCode", label: "Poštanski broj" },
  { key: "phone", label: "Telefon" },
  { key: "email", label: "E-mail" },
  { key: "sku", label: "Šifra artikla" },
  { key: "supplierName", label: "Dobavljač" },
  { key: "categoryName", label: "Kategorija" },
  { key: "groupName", label: "Grupa" },
  { key: "subgroupName", label: "Podgrupa" },
  { key: "collectionName", label: "Kolekcija" },
  { key: "shortDescription", label: "Kratki opis" },
  { key: "shortName", label: "Kratki naziv" },
  { key: "attribute1", label: "Atribut 1" },
  { key: "attribute2", label: "Atribut 2" },
  { key: "attribute3", label: "Atribut 3" },
  { key: "attribute4", label: "Atribut 4" },
  { key: "color1", label: "Boja 1" },
  { key: "color2", label: "Boja 2" },
  { key: "qty", label: "Količina", align: "right" },
  { key: "unitPriceGross", label: "MP cena", align: "right" },
  { key: "totalNet", label: "Ukupno bez PDV", align: "right" },
  { key: "totalGross", label: "Ukupno sa PDV", align: "right" },
  { key: "warehouseName", label: "Magacin" },
  { key: "refunded", label: "Refundirano", align: "center" },
];

export function FiscalizationClient({
  rows,
  warehouses,
  manualOrders,
  paymentMethods,
  manualFiscalizeAction,
  refundAction,
}: {
  rows: FiscalizationRow[];
  warehouses: WarehouseOption[];
  manualOrders: ManualOrder[];
  paymentMethods: string[];
  manualFiscalizeAction: AdminFormAction;
  refundAction: AdminFormAction;
}) {
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [manualOpen, setManualOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const refundableIds = useMemo(() => rows.filter((row) => !row.refunded).map((row) => row.id), [rows]);
  const selectedRefundable = selectedRows.filter((id) => refundableIds.includes(id));
  const allVisibleRefundableSelected = refundableIds.length > 0 && refundableIds.every((id) => selectedRows.includes(id));

  const toggleRow = (id: string) => {
    setSelectedRows((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  const toggleAll = () => {
    setSelectedRows(allVisibleRefundableSelected ? [] : refundableIds);
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div className="text-sm text-ink-500">
          Izabrano: <span className="font-medium text-ink-800">{selectedRefundable.length}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={() => setManualOpen(true)}>
            <ReceiptText className="size-4" />
            Ručna fiskalizacija
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={!selectedRefundable.length}
            onClick={() => setRefundOpen(true)}
          >
            <RotateCcw className="size-4" />
            Refundiraj
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[3200px] text-sm">
          <thead className="bg-muted-bg/60 text-xs uppercase tracking-[0.14em] text-ink-500">
            <tr>
              <th className="sticky left-0 z-10 bg-muted-bg px-3 py-3 text-left">
                <input
                  type="checkbox"
                  checked={allVisibleRefundableSelected}
                  onChange={toggleAll}
                  aria-label="Izaberi sve redove za refundaciju"
                />
              </th>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={`whitespace-nowrap px-3 py-3 font-medium ${
                    column.align === "right"
                      ? "text-right"
                      : column.align === "center"
                        ? "text-center"
                        : "text-left"
                  }`}
                >
                  {column.label}
                </th>
              ))}
              <th className="whitespace-nowrap px-3 py-3 text-left font-medium">Fiskalni račun</th>
              <th className="whitespace-nowrap px-3 py-3 text-left font-medium">Datum</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-muted-bg/30">
                <td className="sticky left-0 z-10 bg-surface px-3 py-3">
                  <input
                    type="checkbox"
                    checked={selectedRows.includes(row.id)}
                    disabled={row.refunded}
                    onChange={() => toggleRow(row.id)}
                    aria-label={`Izaberi red ${row.sku}`}
                  />
                </td>
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`max-w-[240px] px-3 py-3 align-top text-ink-700 ${
                      column.align === "right"
                        ? "text-right"
                        : column.align === "center"
                          ? "text-center"
                          : "text-left"
                    }`}
                  >
                    {column.key === "refunded" ? (
                      <input type="checkbox" checked={row.refunded} readOnly aria-label="Refundirano" />
                    ) : (
                      <span className="line-clamp-2 break-words">{String(row[column.key])}</span>
                    )}
                  </td>
                ))}
                <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-ink-700">
                  {row.fiscalReceiptNumber}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-xs text-ink-600">{row.issuedAt}</td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={columns.length + 3} className="px-4 py-10 text-center text-ink-500">
                  Nema fiskalizovanih redova za izabrane filtere.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <ManualFiscalizationDialog
        open={manualOpen}
        onOpenChange={setManualOpen}
        orders={manualOrders}
        paymentMethods={paymentMethods}
        action={manualFiscalizeAction}
      />
      <RefundDialog
        open={refundOpen}
        onOpenChange={setRefundOpen}
        selectedIds={selectedRefundable}
        warehouses={warehouses}
        paymentMethods={paymentMethods}
        action={refundAction}
      />
    </div>
  );
}

function ManualFiscalizationDialog({
  open,
  onOpenChange,
  orders,
  paymentMethods,
  action,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  orders: ManualOrder[];
  paymentMethods: string[];
  action: AdminFormAction;
}) {
  const [orderId, setOrderId] = useState(orders[0]?.id ?? "");
  const order = orders.find((item) => item.id === orderId) ?? orders[0] ?? null;
  const [selectedItems, setSelectedItems] = useState<string[]>(() => order?.lines.map((line) => line.id) ?? []);

  const changeOrder = (nextOrderId: string) => {
    const nextOrder = orders.find((item) => item.id === nextOrderId) ?? null;
    setOrderId(nextOrderId);
    setSelectedItems(nextOrder?.lines.map((line) => line.id) ?? []);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Ručna fiskalizacija</DialogTitle>
          <DialogDescription>Izaberite porudžbinu, stavke i način plaćanja.</DialogDescription>
        </DialogHeader>
        <AdminActionForm action={action} className="space-y-4">
          <input type="hidden" name="orderId" value={order?.id ?? ""} />
          {selectedItems.map((id) => (
            <input key={id} type="hidden" name="orderItemIds" value={id} />
          ))}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="font-medium text-ink-700">Porudžbina</span>
              <select
                value={order?.id ?? ""}
                onChange={(event) => changeOrder(event.target.value)}
                className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
              >
                {orders.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.number} · {item.customer} · {item.city}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-ink-700">Način plaćanja</span>
              <select
                name="paymentMethod"
                defaultValue={order?.paymentMethod ?? paymentMethods[0]}
                className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
              >
                {paymentMethods.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="max-h-[320px] overflow-auto rounded-lg border border-border/70">
            {order?.lines.map((line) => (
              <label key={line.id} className="flex items-start gap-3 border-b border-border/60 px-3 py-3 text-sm last:border-b-0">
                <input
                  type="checkbox"
                  checked={selectedItems.includes(line.id)}
                  onChange={() =>
                    setSelectedItems((current) =>
                      current.includes(line.id)
                        ? current.filter((item) => item !== line.id)
                        : [...current, line.id],
                    )
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-ink-800">{line.name}</span>
                  <span className="block text-xs text-ink-500">
                    {line.sku} · preostalo {line.remainingQty}/{line.orderedQty} · {line.unitPriceGross}
                  </span>
                </span>
              </label>
            )) ?? <p className="px-3 py-6 text-sm text-ink-500">Nema nefiskalizovanih stavki.</p>}
          </div>
          <DialogFooter>
            <SubmitButton size="sm" pendingLabel="Fiskalizacija…">
              Fiskalizuj
            </SubmitButton>
          </DialogFooter>
        </AdminActionForm>
      </DialogContent>
    </Dialog>
  );
}

function RefundDialog({
  open,
  onOpenChange,
  selectedIds,
  warehouses,
  paymentMethods,
  action,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  selectedIds: string[];
  warehouses: WarehouseOption[];
  paymentMethods: string[];
  action: AdminFormAction;
}) {
  const defaultWarehouse = warehouses.find((warehouse) => warehouse.isDefault) ?? warehouses[0];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Refundacija</DialogTitle>
          <DialogDescription>
            Refundira se cela preostala količina za {selectedIds.length} izabranih redova.
          </DialogDescription>
        </DialogHeader>
        <AdminActionForm action={action} className="space-y-4">
          {selectedIds.map((id) => (
            <input key={id} type="hidden" name="fiscalLineIds" value={id} />
          ))}
          <label className="space-y-1 text-sm">
            <span className="font-medium text-ink-700">Način vraćanja novca</span>
            <select
              name="paymentReturnMethod"
              defaultValue={paymentMethods[0]}
              className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
            >
              {paymentMethods.map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium text-ink-700">Magacin za povrat artikala</span>
            <select
              name="warehouseId"
              defaultValue={defaultWarehouse?.id}
              className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
            >
              {warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.name} ({warehouse.code})
                </option>
              ))}
            </select>
          </label>
          <DialogFooter>
            <SubmitButton variant="destructive" size="sm" pendingLabel="Refundacija…">
              Refundiraj
            </SubmitButton>
          </DialogFooter>
        </AdminActionForm>
      </DialogContent>
    </Dialog>
  );
}
