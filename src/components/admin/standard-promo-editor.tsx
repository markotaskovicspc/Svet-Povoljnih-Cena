"use client";

import { useState } from "react";
import { ProductPicker, type SelectedProduct } from "./simple-landing-page-editor";
import { AdminActionForm } from "./action-form";
import { SubmitButton } from "./submit-button";
import { Button } from "@/components/ui/button";
import type { AdminActionState } from "@/lib/admin/action-state";

export function StandardPromoEditor({ pageKey, initialProducts, manual, action }: {
  pageKey: string;
  initialProducts: SelectedProduct[];
  manual: boolean;
  action: (state: AdminActionState, data: FormData) => Promise<AdminActionState>;
}) {
  const [products, setProducts] = useState(initialProducts);
  const [automatic, setAutomatic] = useState(!manual);
  return <AdminActionForm action={action} refreshOnSuccess preserveValues className="space-y-5">
    <input type="hidden" name="pageKey" value={pageKey} />
    <input type="hidden" name="productSkus" value={JSON.stringify(automatic ? [] : products.map(product => product.sku))} />
    <p className="text-sm text-ink-600">Pomerite proizvode gore ili dole. Sačuvani redosled koristi se na ovoj promo stranici i u njenom redu na početnoj. Sadržaj ponude se i dalje automatski ažurira iz kataloga i akcija.</p>
    <ProductPicker products={products} reorderOnly onChange={next => { setProducts(next); setAutomatic(false); }} />
    <p className="text-sm text-ink-500">{automatic ? "Izabran je automatski redosled kataloga." : "Izabran je ručni redosled. Novi artikli dolaze iza poređanih proizvoda."}</p>
    <div className="flex flex-wrap justify-between gap-3">
      <Button type="button" variant="outline" onClick={() => setAutomatic(true)}>Vrati automatski redosled</Button>
      <SubmitButton>Sačuvaj redosled</SubmitButton>
    </div>
  </AdminActionForm>;
}
