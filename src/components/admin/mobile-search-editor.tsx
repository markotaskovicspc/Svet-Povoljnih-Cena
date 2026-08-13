"use client";

import { useState } from "react";
import Image from "next/image";
import { ChevronDown, ChevronUp, Search, Trash2 } from "lucide-react";
import type { AdminActionState } from "@/lib/admin/action-state";
import { AdminActionForm } from "@/components/admin/action-form";
import { Card, CardTitle } from "@/components/admin/card";
import { Field } from "@/components/admin/field";
import { SubmitButton } from "@/components/admin/submit-button";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export interface MobileSearchAdminProduct {
  sku: string;
  name: string;
  slug: string;
  imageUrl: string;
}

interface DestinationOption {
  label: string;
  value: string;
}

interface CurrentItemValue {
  label: string;
  imageUrl: string;
  destination: string;
  customHref: string;
}

export function MobileSearchEditor({
  action,
  currentItems,
  selectedProducts,
  frequentQueries,
  viewAllDestination,
  viewAllCustomHref,
  destinationOptions,
}: {
  action: (state: AdminActionState, formData: FormData) => Promise<AdminActionState>;
  currentItems: CurrentItemValue[];
  selectedProducts: MobileSearchAdminProduct[];
  frequentQueries: string[];
  viewAllDestination: string;
  viewAllCustomHref: string;
  destinationOptions: DestinationOption[];
}) {
  const [products, setProducts] = useState(selectedProducts);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MobileSearchAdminProduct[]>([]);
  const [busy, setBusy] = useState(false);

  const searchProducts = async () => {
    const term = query.trim();
    if (term.length < 2) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/landing-products?q=${encodeURIComponent(term)}`);
      const payload = (await response.json()) as { products?: MobileSearchAdminProduct[] };
      setResults(Array.isArray(payload.products) ? payload.products : []);
    } finally {
      setBusy(false);
    }
  };

  const moveProduct = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= products.length) return;
    setProducts((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  };

  return (
    <AdminActionForm action={action} className="space-y-6" testId="mobile-search-config-form">
      <Card>
        <CardTitle description="Dve stavke se prikazuju prve, kao na referentnom Forma Ideale ekranu. Preporučena slika je odnos 4:3; sistem je automatski pretvara u WebP.">
          Aktuelno
        </CardTitle>
        <div className="grid gap-5 lg:grid-cols-2">
          {Array.from({ length: 2 }, (_, index) => {
            const item = currentItems[index] ?? {
              label: "",
              imageUrl: "",
              destination: "",
              customHref: "",
            };
            const position = index + 1;
            return (
              <div key={position} className="space-y-4 rounded-xl border border-border/70 p-4">
                <h3 className="font-semibold text-ink-900">Stavka {position}</h3>
                {item.imageUrl ? (
                  <div className="relative aspect-[4/3] w-40 overflow-hidden rounded-lg bg-muted-bg ring-1 ring-border/60">
                    <Image src={item.imageUrl} alt="" fill sizes="160px" className="object-cover" unoptimized />
                  </div>
                ) : null}
                <input type="hidden" name={`currentImageUrl${position}`} value={item.imageUrl} />
                <Field label="Naziv">
                  <Input name={`currentLabel${position}`} defaultValue={item.label} minLength={2} maxLength={60} required />
                </Field>
                <Field label="Odredište iz sistema">
                  <select
                    name={`currentDestination${position}`}
                    defaultValue={item.destination}
                    className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
                  >
                    <option value="">— Izaberite ili unesite link —</option>
                    {destinationOptions.map((option) => (
                      <option key={`${position}-${option.value}`} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Prilagođeni interni link" hint="Opciono; ima prednost nad izabranim odredištem.">
                  <Input name={`currentCustomHref${position}`} defaultValue={item.customHref} placeholder="/k/namestaj" />
                </Field>
                <Field label={item.imageUrl ? "Zameni sliku" : "Slika"}>
                  <Input name={`currentImageFile${position}`} type="file" accept="image/png,image/jpeg,image/webp,image/avif" required={!item.imageUrl} />
                </Field>
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <CardTitle description="Izaberite tačno četiri aktivna proizvoda. Redosled ovde je redosled u mobilnoj pretrazi.">
          Najpopularniji proizvodi
        </CardTitle>
        {products.map((product, index) => (
          <div
            key={product.sku}
            data-testid={`mobile-search-selected-product-${product.sku}`}
            className="mb-2 flex items-center gap-3 rounded-lg border border-border/70 p-2"
          >
            <input type="hidden" name="productSkus" value={product.sku} />
            <div className="relative size-12 shrink-0 overflow-hidden rounded-md bg-muted-bg">
              {product.imageUrl ? <Image src={product.imageUrl} alt="" fill sizes="48px" className="object-contain p-1" unoptimized /> : null}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{product.name}</p>
              <p className="font-mono text-xs text-ink-500">{product.sku}</p>
            </div>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Pomeri ${product.name} gore`} disabled={index === 0} onClick={() => moveProduct(index, -1)}><ChevronUp /></Button>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Pomeri ${product.name} dole`} disabled={index === products.length - 1} onClick={() => moveProduct(index, 1)}><ChevronDown /></Button>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Ukloni ${product.name}`} onClick={() => setProducts((current) => current.filter((item) => item.sku !== product.sku))}><Trash2 /></Button>
          </div>
        ))}
        <div className="mt-4 space-y-3 rounded-xl bg-muted-bg p-4">
          <Field label="Pronađite proizvod" hint={`${products.length}/4 izabrana proizvoda`}>
            <div className="flex gap-2">
              <Input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void searchProducts(); } }} />
              <Button type="button" variant="outline" disabled={busy || query.trim().length < 2} onClick={searchProducts}><Search className="size-4" /> Pretraži</Button>
            </div>
          </Field>
          {results.length ? (
            <div className="grid gap-2 md:grid-cols-2">
              {results.map((product) => {
                const selected = products.some((item) => item.sku === product.sku);
                return (
                  <button
                    type="button"
                    key={product.sku}
                    data-testid={`mobile-search-product-result-${product.sku}`}
                    disabled={selected || products.length >= 4}
                    onClick={() => setProducts((current) => [...current, product])}
                    className="flex items-center gap-2 rounded-lg border bg-white p-2 text-left hover:bg-surface disabled:opacity-45"
                  >
                    <div className="relative size-10 shrink-0 overflow-hidden rounded bg-muted-bg">
                      {product.imageUrl ? <Image src={product.imageUrl} alt="" fill sizes="40px" className="object-contain" unoptimized /> : null}
                    </div>
                    <span className="min-w-0"><span className="block truncate text-sm font-medium">{product.name}</span><span className="font-mono text-xs text-ink-500">{product.sku}</span></span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </Card>

      <Card>
        <CardTitle description="Fraze se prikazuju redom i vode direktno na punu stranicu rezultata.">
          Najčešće pretrage
        </CardTitle>
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 6 }, (_, index) => (
            <Field key={index} label={`Fraza ${index + 1}`}>
              <Input name={`frequentQuery${index + 1}`} defaultValue={frequentQueries[index] ?? ""} minLength={3} maxLength={80} required />
            </Field>
          ))}
        </div>
      </Card>

      <Card>
        <CardTitle description="Kada korisnik unese 3 ili više znakova, dugme automatski vodi na sve rezultate tog upita.">
          Dugme „Pogledaj sve“ bez upita
        </CardTitle>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Odredište iz sistema">
            <select name="viewAllDestination" defaultValue={viewAllDestination} className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm">
              <option value="">— Izaberite ili unesite link —</option>
              {destinationOptions.map((option) => <option key={`cta-${option.value}`} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
          <Field label="Prilagođeni interni link" hint="Opciono; ima prednost nad izabranim odredištem.">
            <Input name="viewAllCustomHref" defaultValue={viewAllCustomHref} placeholder="/akcija" />
          </Field>
        </div>
      </Card>

      <div className="sticky bottom-4 flex justify-end rounded-xl border border-border/70 bg-white/95 p-4 shadow-soft-3 backdrop-blur">
        <SubmitButton pendingLabel="Čuvanje mobilne pretrage…" disabled={products.length !== 4}>Sačuvaj mobilnu pretragu</SubmitButton>
      </div>
    </AdminActionForm>
  );
}
