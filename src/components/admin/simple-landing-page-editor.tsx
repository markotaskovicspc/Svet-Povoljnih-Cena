"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  Search,
  Trash2,
} from "lucide-react";
import type { AdminActionState } from "@/lib/admin/action-state";
import { AdminActionForm } from "@/components/admin/action-form";
import { Field } from "@/components/admin/field";
import { MediaUrlField } from "@/components/admin/landing-page-editor";
import { SubmitButton } from "@/components/admin/submit-button";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EMPTY_HERO_PICTOGRAMS } from "@/lib/landing-pages/blocks";
import { cn } from "@/lib/utils";

type SelectedProduct = {
  sku: string;
  name: string;
  slug: string;
  imageUrl: string;
  availableForWeb: boolean;
  exists: boolean;
};

type SimpleLandingEditorValues = {
  id?: string;
  slug: string;
  title: string;
  heroImageUrl: string | null;
  heroMobileImageUrl: string | null;
  heroImageAlt: string | null;
  heroCtaLabel: string | null;
  heroCtaHref: string | null;
  productSkus: string[];
  seoTitle: string | null;
  seoDescription: string | null;
  ogImageUrl: string | null;
  canonicalUrl: string | null;
  robotsIndex: boolean;
  startsAt: string | null;
  endsAt: string | null;
  lockedSlug: boolean;
};

function toLocalDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function toIsoDateTime(value: string) {
  return value ? new Date(value).toISOString() : "";
}

export function SimpleLandingPageEditor({
  action,
  values,
  initialProducts,
  previewHref,
}: {
  action: (state: AdminActionState, formData: FormData) => Promise<AdminActionState>;
  values: SimpleLandingEditorValues;
  initialProducts: SelectedProduct[];
  previewHref?: string;
}) {
  const [slug, setSlug] = useState(values.slug);
  const [title, setTitle] = useState(values.title);
  const [heroImageUrl, setHeroImageUrl] = useState(values.heroImageUrl ?? "");
  const [heroMobileImageUrl, setHeroMobileImageUrl] = useState(
    values.heroMobileImageUrl ?? "",
  );
  const [heroImageAlt, setHeroImageAlt] = useState(values.heroImageAlt ?? "");
  const [heroCtaLabel, setHeroCtaLabel] = useState(values.heroCtaLabel ?? "");
  const [heroCtaHref, setHeroCtaHref] = useState(values.heroCtaHref ?? "#proizvodi");
  const [products, setProducts] = useState(initialProducts);
  const [seoTitle, setSeoTitle] = useState(values.seoTitle ?? "");
  const [seoDescription, setSeoDescription] = useState(values.seoDescription ?? "");
  const [ogImageUrl, setOgImageUrl] = useState(values.ogImageUrl ?? "");
  const [canonicalUrl, setCanonicalUrl] = useState(values.canonicalUrl ?? "");
  const [robotsIndex, setRobotsIndex] = useState(values.robotsIndex);
  const [startsAt, setStartsAt] = useState(toLocalDateTime(values.startsAt));
  const [endsAt, setEndsAt] = useState(toLocalDateTime(values.endsAt));
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile">("desktop");
  const publishIssues = useMemo(() => {
    const issues: string[] = [];
    if (!heroImageUrl) issues.push("Dodajte desktop sliku banera.");
    if (!heroCtaLabel || !heroCtaHref) issues.push("Unesite naziv i link CTA dugmeta.");
    if (!products.length) issues.push("Dodajte najmanje jedan proizvod.");
    const unavailable = products.filter((product) => !product.availableForWeb);
    if (unavailable.length) {
      issues.push(`${unavailable.length} izabranih proizvoda trenutno nije dostupno za web.`);
    }
    return issues;
  }, [heroCtaHref, heroCtaLabel, heroImageUrl, products]);

  return (
    <AdminActionForm action={action} className="space-y-6">
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
      <input type="hidden" name="template" value="SIMPLE_PRODUCT_LIST" />
      <input type="hidden" name="blocks" value="[]" />
      <input type="hidden" name="productSkus" value={JSON.stringify(products.map((product) => product.sku))} />
      <input type="hidden" name="heroPictograms" value={JSON.stringify(EMPTY_HERO_PICTOGRAMS)} />
      <input type="hidden" name="startsAt" value={toIsoDateTime(startsAt)} />
      <input type="hidden" name="endsAt" value={toIsoDateTime(endsAt)} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <EditorSection
            title="Osnovni podaci"
            description="Naziv se koristi kao nevidljivi H1 i SEO fallback; ne prikazuje se preko banera."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Slug" hint="Javna adresa je /ponuda/slug">
                <Input
                  name="slug"
                  required
                  value={slug}
                  onChange={(event) => setSlug(event.target.value)}
                  readOnly={values.lockedSlug}
                  className={values.lockedSlug ? "bg-muted-bg" : undefined}
                />
              </Field>
              <Field label="Naziv stranice (nevidljivi H1)">
                <Input
                  name="title"
                  required
                  maxLength={160}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </Field>
            </div>
          </EditorSection>

          <EditorSection
            title="Glavni baner"
            description="Iste proporcije kao na početnoj: desktop 24:7, mobilni prikaz kvadrat. Na slici je samo CTA dole levo."
          >
            <MediaUrlField
              pageId={values.id}
              label="Desktop slika"
              name="heroImageUrl"
              value={heroImageUrl}
              onChange={setHeroImageUrl}
            />
            <MediaUrlField
              pageId={values.id}
              label="Mobilna slika"
              name="heroMobileImageUrl"
              value={heroMobileImageUrl}
              onChange={setHeroMobileImageUrl}
            />
            <Field label="Alt tekst slike">
              <Input
                name="heroImageAlt"
                maxLength={240}
                value={heroImageAlt}
                onChange={(event) => setHeroImageAlt(event.target.value)}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Naziv CTA dugmeta">
                <Input
                  name="heroCtaLabel"
                  required
                  maxLength={80}
                  value={heroCtaLabel}
                  onChange={(event) => setHeroCtaLabel(event.target.value)}
                  placeholder="Pogledajte proizvode"
                />
              </Field>
              <Field label="CTA link" hint="Može biti #proizvodi, interni put ili HTTPS link.">
                <Input
                  name="heroCtaHref"
                  required
                  value={heroCtaHref}
                  onChange={(event) => setHeroCtaHref(event.target.value)}
                  placeholder="#proizvodi"
                />
              </Field>
            </div>
          </EditorSection>

          <EditorSection
            title="Proizvodi"
            description="Ručno izaberite postojeće artikle. Nema ograničenja broja, a redosled ovde je podrazumevani redosled na stranici."
          >
            <ProductPicker products={products} onChange={setProducts} />
          </EditorSection>

          <EditorSection title="SEO i društvene mreže" description="Naslov ima fallback na naziv stranice.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="SEO naslov" hint={`${seoTitle.length} / 160`}>
                <Input name="seoTitle" maxLength={160} value={seoTitle} onChange={(event) => setSeoTitle(event.target.value)} />
              </Field>
              <Field label="Canonical URL">
                <Input name="canonicalUrl" value={canonicalUrl} onChange={(event) => setCanonicalUrl(event.target.value)} placeholder={`/ponuda/${slug || "slug"}`} />
              </Field>
            </div>
            <Field label="Meta opis" hint={`${seoDescription.length} / 500`}>
              <Textarea name="seoDescription" rows={3} maxLength={500} value={seoDescription} onChange={(event) => setSeoDescription(event.target.value)} />
            </Field>
            <MediaUrlField pageId={values.id} label="Open Graph slika" name="ogImageUrl" value={ogImageUrl} onChange={setOgImageUrl} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="robotsIndex" checked={robotsIndex} onChange={(event) => setRobotsIndex(event.target.checked)} className="size-4 accent-walnut" />
              Dozvoli indeksiranje u pretraživačima
            </label>
            <div className="rounded-xl border border-border/60 bg-white p-4">
              <p className="text-lg text-[#1a0dab]">{seoTitle || title || "Naziv landing strane"}</p>
              <p className="text-sm text-[#006621]">www.svetpovoljnihcena.rs{canonicalUrl || `/ponuda/${slug || "slug"}`}</p>
              <p className="mt-1 text-sm text-[#4d5156]">{seoDescription || "Meta opis landing strane."}</p>
            </div>
          </EditorSection>

          <EditorSection title="Period objave" description="Prazno znači bez vremenskog ograničenja.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Početak"><Input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></Field>
              <Field label="Kraj"><Input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></Field>
            </div>
          </EditorSection>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <div className="rounded-2xl border border-border/60 bg-surface p-5 shadow-sm">
            <h2 className="font-display text-lg text-ink-900">Objava</h2>
            <p className="mt-2 text-sm text-ink-500">Čuvanje nacrta ne menja poslednju javno objavljenu verziju.</p>
            {publishIssues.length ? (
              <div className="mt-4 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-ink-700">
                <p className="font-semibold">Pre objave proverite:</p>
                <ul className="mt-2 list-disc space-y-1 pl-4">
                  {publishIssues.slice(0, 6).map((issue) => <li key={issue}>{issue}</li>)}
                </ul>
              </div>
            ) : null}
            <div className="mt-4 grid gap-2">
              <SubmitButton name="intent" value="save" variant="outline" pendingLabel="Čuvanje…">Sačuvaj nacrt</SubmitButton>
              <SubmitButton name="intent" value="publish" pendingLabel="Objavljivanje…" confirm="Objaviti ovu verziju landing strane?">Objavi verziju</SubmitButton>
              {previewHref ? <Link href={previewHref} target="_blank" className={buttonVariants({ variant: "ghost" })}>Otvori admin pregled</Link> : null}
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border/60 bg-surface shadow-sm">
            <div className="flex items-center justify-between border-b border-border/60 px-3 py-2 text-xs">
              <span className="text-ink-500">Brzi pregled</span>
              <div className="flex rounded-full bg-muted-bg p-0.5">
                {(["desktop", "mobile"] as const).map((device) => (
                  <button key={device} type="button" onClick={() => setPreviewDevice(device)} className={cn("rounded-full px-2 py-1", previewDevice === device && "bg-white shadow-sm")}>
                    {device === "desktop" ? "Desktop" : "Mobilni"}
                  </button>
                ))}
              </div>
            </div>
            <div className={cn("relative bg-white", previewDevice === "mobile" ? "mx-auto aspect-square max-w-72" : "aspect-[24/7]")}>
              {(previewDevice === "mobile" ? heroMobileImageUrl || heroImageUrl : heroImageUrl) ? <Image src={previewDevice === "mobile" ? heroMobileImageUrl || heroImageUrl : heroImageUrl} alt="" fill unoptimized loading="eager" className="object-contain" /> : null}
              {heroCtaLabel ? (
                <span className="absolute bottom-4 left-4 rounded-full bg-canvas px-4 py-2 text-xs text-ink-900 shadow-soft-2">
                  {heroCtaLabel}
                </span>
              ) : null}
            </div>
            <div className="p-4 text-xs text-ink-500">Brzi pregled · {products.length} {products.length === 1 ? "proizvod" : "proizvoda"}</div>
          </div>
        </aside>
      </div>
    </AdminActionForm>
  );
}

function EditorSection({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-2xl border border-border/60 bg-surface p-6 shadow-sm">
      <div>
        <h2 className="font-display text-xl text-ink-900">{title}</h2>
        {description ? <p className="mt-1 text-sm text-ink-500">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function ProductPicker({ products, onChange }: { products: SelectedProduct[]; onChange: (products: SelectedProduct[]) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SelectedProduct[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selectedSkus = useMemo(() => new Set(products.map((product) => product.sku)), [products]);

  const search = async () => {
    if (query.trim().length < 2) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/landing-products?q=${encodeURIComponent(query)}`);
      const payload = await response.json() as {
        products?: Array<Omit<SelectedProduct, "availableForWeb" | "exists">>;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "Proizvodi nisu učitani.");
      setResults((payload.products ?? []).map((product) => ({
        ...product,
        availableForWeb: true,
        exists: true,
      })));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Proizvodi nisu učitani.");
    } finally {
      setBusy(false);
    }
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= products.length) return;
    const next = [...products];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  };

  return (
    <div className="space-y-4">
      <Field label="Pretraga po nazivu ili SKU-u">
        <div className="flex gap-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void search();
              }
            }}
            placeholder="Unesite najmanje dva znaka"
          />
          <Button type="button" variant="outline" disabled={busy || query.trim().length < 2} onClick={() => void search()}>
            <Search className="size-4" /> {busy ? "Tražim…" : "Pretraži"}
          </Button>
        </div>
      </Field>
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      {results.length ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {results.map((product) => (
            <button
              type="button"
              key={product.sku}
              disabled={selectedSkus.has(product.sku)}
              onClick={() => onChange([...products, product])}
              className="flex items-center gap-3 rounded-lg border p-2 text-left transition hover:bg-muted-bg disabled:opacity-50"
            >
              <ProductThumb product={product} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{product.name}</span>
                <span className="font-mono text-xs text-ink-500">{product.sku}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex items-center justify-between border-t border-border/60 pt-4">
        <p className="text-sm font-semibold text-ink-900">Izabrani proizvodi</p>
        <span className="text-xs text-ink-500">{products.length} ukupno</span>
      </div>
      {products.length ? (
        <div className="max-h-[720px] space-y-2 overflow-y-auto pr-1">
          {products.map((product, index) => (
            <div key={product.sku} className={cn("flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2", !product.availableForWeb && "border-warning/40 bg-warning/5")}>
              <GripVertical className="size-4 shrink-0 text-ink-400" aria-hidden />
              <ProductThumb product={product} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink-900">{product.name}</span>
                <span className="block font-mono text-xs text-ink-500">{product.sku}</span>
                {!product.availableForWeb ? <span className="block text-xs text-warning">{product.exists ? "Trenutno nije dostupan za web" : "Artikal više ne postoji"}</span> : null}
              </span>
              <ProductIconButton label="Pomeri gore" disabled={index === 0} onClick={() => move(index, -1)}><ChevronUp /></ProductIconButton>
              <ProductIconButton label="Pomeri dole" disabled={index === products.length - 1} onClick={() => move(index, 1)}><ChevronDown /></ProductIconButton>
              <ProductIconButton label="Ukloni" danger onClick={() => onChange(products.filter((_, at) => at !== index))}><Trash2 /></ProductIconButton>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-ink-500">Nijedan proizvod nije izabran.</p>
      )}
    </div>
  );
}

function ProductThumb({ product }: { product: SelectedProduct }) {
  return product.imageUrl ? (
    <Image src={product.imageUrl} alt="" width={48} height={48} unoptimized className="size-12 shrink-0 rounded-md object-cover" />
  ) : (
    <span className="size-12 shrink-0 rounded-md bg-muted-bg" aria-hidden />
  );
}

function ProductIconButton({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactElement }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn("rounded-md p-1.5 text-ink-500 hover:bg-muted-bg hover:text-ink-900 disabled:opacity-30 [&>svg]:size-4", danger && "hover:text-danger")}
    >
      {children}
    </button>
  );
}
