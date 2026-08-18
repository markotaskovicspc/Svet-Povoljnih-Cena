"use client";

import { useMemo, useState } from "react";
import { Field } from "@/components/admin/field";
import { Input } from "@/components/ui/input";

type LoadingLocationOption = {
  id: string;
  name: string;
  position: number;
};

type SupplierOption = {
  id: string;
  name: string;
  paymentTerms: string | null;
  loadingLocations: LoadingLocationOption[];
};

export function PurchaseOrderSupplierFields({
  suppliers,
  initialSupplierId,
  initialLoadingLocationId,
}: {
  suppliers: SupplierOption[];
  initialSupplierId: string;
  initialLoadingLocationId: string;
}) {
  const [supplierId, setSupplierId] = useState(initialSupplierId);
  const [loadingLocationId, setLoadingLocationId] = useState(() => {
    const supplier = suppliers.find((candidate) => candidate.id === initialSupplierId);
    return supplier?.loadingLocations.some(
      (location) => location.id === initialLoadingLocationId,
    )
      ? initialLoadingLocationId
      : "";
  });
  const selectedSupplier = useMemo(
    () => suppliers.find((supplier) => supplier.id === supplierId) ?? null,
    [supplierId, suppliers],
  );

  return (
    <>
      <Field label="Dobavljač">
        <select
          name="supplierId"
          required
          value={supplierId}
          onChange={(event) => {
            const nextSupplierId = event.target.value;
            setSupplierId(nextSupplierId);
            const nextSupplier = suppliers.find(
              (supplier) => supplier.id === nextSupplierId,
            );
            if (
              !nextSupplier?.loadingLocations.some(
                (location) => location.id === loadingLocationId,
              )
            ) {
              setLoadingLocationId("");
            }
          }}
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
        >
          <option value="">— izaberite —</option>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Uslovi plaćanja">
        <Input
          value={selectedSupplier?.paymentTerms ?? ""}
          readOnly
          placeholder="Iz baze dobavljača"
        />
      </Field>
      <Field label="Mesto utovara">
        <select
          name="loadingLocationId"
          required
          value={loadingLocationId}
          onChange={(event) => setLoadingLocationId(event.target.value)}
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
        >
          <option value="">— izaberite —</option>
          {selectedSupplier?.loadingLocations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.position}. {location.name}
            </option>
          ))}
        </select>
      </Field>
    </>
  );
}
