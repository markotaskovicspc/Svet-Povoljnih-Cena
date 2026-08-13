"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  GripVertical,
  ImagePlus,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import type { AdminActionState } from "@/lib/admin/action-state";
import { AdminActionForm } from "@/components/admin/action-form";
import { Field } from "@/components/admin/field";
import { SubmitButton } from "@/components/admin/submit-button";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  EMPTY_HERO_PICTOGRAMS,
  LANDING_BLOCK_TYPES,
  LANDING_PICTOGRAM_SLOTS,
  newLandingBlock,
  validateLandingBlocksForPublish,
  type LandingBlock,
  type LandingBlockType,
  type LandingHeroPictograms,
} from "@/lib/landing-pages/blocks";
import { cn } from "@/lib/utils";

type LandingEditorValues = {
  id?: string;
  template: "BUILDER" | "SIMPLE_PRODUCT_LIST";
  slug: string;
  title: string;
  lead: string | null;
  heroImageUrl: string | null;
  heroMobileImageUrl: string | null;
  heroImageAlt: string | null;
  heroCtaLabel: string | null;
  heroCtaHref: string | null;
  heroPictograms: LandingHeroPictograms;
  blocks: LandingBlock[];
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

type PictogramOption = { id: string; label: string; code: string; iconUrl: string };

const BLOCK_LABELS: Record<LandingBlockType, string> = {
  RICH_TEXT: "Tekst",
  BANNER: "Baner",
  PRODUCT_GRID: "Proizvodi",
  PICTOGRAM_ROW: "Piktogrami",
  CTA: "Poziv na akciju",
};

const SLOT_LABELS: Record<(typeof LANDING_PICTOGRAM_SLOTS)[number], string> = {
  TOP_LEFT_1: "Gore levo 1",
  TOP_LEFT_2: "Gore levo 2",
  BOTTOM_RIGHT_1: "Dole desno 1",
  BOTTOM_RIGHT_2: "Dole desno 2",
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

function cloneBlock(block: LandingBlock): LandingBlock {
  return {
    ...structuredClone(block),
    id: globalThis.crypto?.randomUUID?.() ?? `${block.type.toLowerCase()}-${Date.now()}`,
  };
}

export function LandingPageEditor({
  action,
  values,
  pictograms,
  previewHref,
}: {
  action: (state: AdminActionState, formData: FormData) => Promise<AdminActionState>;
  values: LandingEditorValues;
  pictograms: PictogramOption[];
  previewHref?: string;
}) {
  const [slug, setSlug] = useState(values.slug);
  const [title, setTitle] = useState(values.title);
  const [lead, setLead] = useState(values.lead ?? "");
  const [heroImageUrl, setHeroImageUrl] = useState(values.heroImageUrl ?? "");
  const [heroMobileImageUrl, setHeroMobileImageUrl] = useState(values.heroMobileImageUrl ?? "");
  const [heroImageAlt, setHeroImageAlt] = useState(values.heroImageAlt ?? "");
  const [heroCtaLabel, setHeroCtaLabel] = useState(values.heroCtaLabel ?? "");
  const [heroCtaHref, setHeroCtaHref] = useState(values.heroCtaHref ?? "");
  const [heroPictograms, setHeroPictograms] = useState<LandingHeroPictograms>(
    values.heroPictograms ?? EMPTY_HERO_PICTOGRAMS,
  );
  const [blocks, setBlocks] = useState<LandingBlock[]>(values.blocks);
  const [seoTitle, setSeoTitle] = useState(values.seoTitle ?? "");
  const [seoDescription, setSeoDescription] = useState(values.seoDescription ?? "");
  const [ogImageUrl, setOgImageUrl] = useState(values.ogImageUrl ?? "");
  const [canonicalUrl, setCanonicalUrl] = useState(values.canonicalUrl ?? "");
  const [robotsIndex, setRobotsIndex] = useState(values.robotsIndex);
  const [startsAt, setStartsAt] = useState(toLocalDateTime(values.startsAt));
  const [endsAt, setEndsAt] = useState(toLocalDateTime(values.endsAt));
  const [blockType, setBlockType] = useState<LandingBlockType>("RICH_TEXT");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const publishIssues = useMemo(() => validateLandingBlocksForPublish(blocks), [blocks]);

  const updateBlock = (id: string, next: LandingBlock) => {
    setBlocks((current) => current.map((block) => (block.id === id ? next : block)));
  };
  const moveBlock = (id: string, delta: number) => {
    setBlocks((current) => {
      const from = current.findIndex((block) => block.id === id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= current.length) return current;
      const next = [...current];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item!);
      return next;
    });
  };
  const dropBefore = (targetId: string) => {
    if (!draggedId || draggedId === targetId) return;
    setBlocks((current) => {
      const dragged = current.find((block) => block.id === draggedId);
      if (!dragged) return current;
      const remaining = current.filter((block) => block.id !== draggedId);
      const target = remaining.findIndex((block) => block.id === targetId);
      remaining.splice(target, 0, dragged);
      return remaining;
    });
    setDraggedId(null);
  };

  return (
    <AdminActionForm action={action} className="space-y-6">
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
      <input type="hidden" name="template" value={values.template} />
      <input type="hidden" name="blocks" value={JSON.stringify(blocks)} />
      <input type="hidden" name="productSkus" value={JSON.stringify(values.productSkus)} />
      <input type="hidden" name="heroPictograms" value={JSON.stringify(heroPictograms)} />
      <input type="hidden" name="startsAt" value={toIsoDateTime(startsAt)} />
      <input type="hidden" name="endsAt" value={toIsoDateTime(endsAt)} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <EditorSection title="Osnovni podaci" description="Javna adresa, jedini H1 naslov i uvodni tekst.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Slug" hint="Javna adresa je /ponuda/slug">
                <Input name="slug" required value={slug} onChange={(event) => setSlug(event.target.value)} readOnly={values.lockedSlug} className={values.lockedSlug ? "bg-muted-bg" : undefined} />
              </Field>
              <Field label="Naslov (H1)">
                <Input name="title" required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} />
              </Field>
            </div>
            <Field label="Uvodni tekst" hint={`${lead.length} / 1.000`}>
              <Textarea name="lead" rows={3} maxLength={1000} value={lead} onChange={(event) => setLead(event.target.value)} />
            </Field>
          </EditorSection>

          <EditorSection title="Hero" description="Desktop/mobile vizual, alternativni tekst, dugme i četiri dekorativna piktograma.">
            <MediaUrlField pageId={values.id} label="Desktop slika" name="heroImageUrl" value={heroImageUrl} onChange={setHeroImageUrl} />
            <MediaUrlField pageId={values.id} label="Mobilna slika" name="heroMobileImageUrl" value={heroMobileImageUrl} onChange={setHeroMobileImageUrl} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Alt tekst slike"><Input name="heroImageAlt" maxLength={240} value={heroImageAlt} onChange={(event) => setHeroImageAlt(event.target.value)} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Naziv dugmeta"><Input name="heroCtaLabel" maxLength={80} value={heroCtaLabel} onChange={(event) => setHeroCtaLabel(event.target.value)} /></Field>
                <Field label="Link dugmeta"><Input name="heroCtaHref" value={heroCtaHref} onChange={(event) => setHeroCtaHref(event.target.value)} placeholder="/k/rasveta" /></Field>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {LANDING_PICTOGRAM_SLOTS.map((slot) => (
                <Field key={slot} label={SLOT_LABELS[slot]}>
                  <select value={heroPictograms[slot] ?? ""} onChange={(event) => setHeroPictograms((current) => ({ ...current, [slot]: event.target.value || null }))} className="h-9 rounded-lg border border-input bg-surface px-2 text-sm">
                    <option value="">Bez piktograma</option>
                    {pictograms.map((pictogram) => <option key={pictogram.id} value={pictogram.id}>{pictogram.label}</option>)}
                  </select>
                </Field>
              ))}
            </div>
          </EditorSection>

          <EditorSection title="Blokovi stranice" description="Prevucite blokove ili koristite strelice. Skriveni blok ostaje u nacrtu, ali se ne prikazuje javno.">
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-muted-bg/40 p-3">
              <select aria-label="Tip novog bloka" value={blockType} onChange={(event) => setBlockType(event.target.value as LandingBlockType)} className="h-9 rounded-lg border border-input bg-surface px-3 text-sm">
                {LANDING_BLOCK_TYPES.map((type) => <option key={type} value={type}>{BLOCK_LABELS[type]}</option>)}
              </select>
              <Button type="button" onClick={() => setBlocks((current) => [...current, newLandingBlock(blockType)])}><Plus className="size-4" /> Dodaj blok</Button>
              <span className="ml-auto text-xs text-ink-500">{blocks.length} / 40 blokova</span>
            </div>
            {blocks.length ? (
              <div className="space-y-4">
                {blocks.map((block, index) => (
                  <div key={block.id} data-block-type={block.type} draggable onDragStart={() => setDraggedId(block.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => dropBefore(block.id)} className={cn("rounded-xl border bg-surface", !block.visible && "opacity-60")}>
                    <div className="flex items-center gap-2 border-b border-border/60 bg-muted-bg/40 px-3 py-2">
                      <GripVertical className="size-4 cursor-grab text-ink-400" aria-hidden />
                      <span className="text-xs font-semibold uppercase tracking-wide text-ink-600">{index + 1}. {BLOCK_LABELS[block.type]}</span>
                      <div className="ml-auto flex gap-1">
                        <IconButton label="Pomeri gore" onClick={() => moveBlock(block.id, -1)} disabled={index === 0}><ChevronUp /></IconButton>
                        <IconButton label="Pomeri dole" onClick={() => moveBlock(block.id, 1)} disabled={index === blocks.length - 1}><ChevronDown /></IconButton>
                        <IconButton label={block.visible ? "Sakrij" : "Prikaži"} onClick={() => updateBlock(block.id, { ...block, visible: !block.visible })}>{block.visible ? <Eye /> : <EyeOff />}</IconButton>
                        <IconButton label="Kopiraj" onClick={() => setBlocks((current) => { const at = current.findIndex((item) => item.id === block.id); const next = [...current]; next.splice(at + 1, 0, cloneBlock(block)); return next; })}><Copy /></IconButton>
                        <IconButton label="Obriši" danger onClick={() => { if (window.confirm("Obrisati ovaj blok?")) setBlocks((current) => current.filter((item) => item.id !== block.id)); }}><Trash2 /></IconButton>
                      </div>
                    </div>
                    <div className="space-y-4 p-4"><BlockFields block={block} pageId={values.id} pictograms={pictograms} onChange={(next) => updateBlock(block.id, next)} /></div>
                  </div>
                ))}
              </div>
            ) : <p className="rounded-xl border border-dashed p-8 text-center text-sm text-ink-500">Još nema blokova. Hero može da postoji samostalno.</p>}
          </EditorSection>

          <EditorSection title="SEO i društvene mreže" description="Naslov i opis imaju fallback na H1 i uvod.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="SEO naslov" hint={`${seoTitle.length} / 160`}><Input name="seoTitle" maxLength={160} value={seoTitle} onChange={(event) => setSeoTitle(event.target.value)} /></Field>
              <Field label="Canonical URL"><Input name="canonicalUrl" value={canonicalUrl} onChange={(event) => setCanonicalUrl(event.target.value)} placeholder={`/ponuda/${slug || "slug"}`} /></Field>
            </div>
            <Field label="Meta opis" hint={`${seoDescription.length} / 500`}><Textarea name="seoDescription" rows={3} maxLength={500} value={seoDescription} onChange={(event) => setSeoDescription(event.target.value)} /></Field>
            <MediaUrlField pageId={values.id} label="Open Graph slika" name="ogImageUrl" value={ogImageUrl} onChange={setOgImageUrl} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="robotsIndex" checked={robotsIndex} onChange={(event) => setRobotsIndex(event.target.checked)} className="size-4 accent-walnut" /> Dozvoli indeksiranje u pretraživačima</label>
            <div className="rounded-xl border border-border/60 bg-white p-4">
              <p className="text-lg text-[#1a0dab]">{seoTitle || title || "Naslov landing strane"}</p>
              <p className="text-sm text-[#006621]">www.svetpovoljnihcena.rs{canonicalUrl || `/ponuda/${slug || "slug"}`}</p>
              <p className="mt-1 text-sm text-[#4d5156]">{seoDescription || lead || "Meta opis landing strane."}</p>
            </div>
          </EditorSection>

          <EditorSection title="Period objave" description="Objavljena strana je javna samo unutar ovog intervala. Prazno znači bez ograničenja.">
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
            {publishIssues.length ? <div className="mt-4 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-ink-700"><p className="font-semibold">Pre objave proverite:</p><ul className="mt-2 list-disc space-y-1 pl-4">{publishIssues.slice(0, 5).map((issue, index) => <li key={`${issue}-${index}`}>{issue}</li>)}</ul></div> : null}
            <div className="mt-4 grid gap-2">
              <SubmitButton name="intent" value="save" variant="outline" pendingLabel="Čuvanje…">Sačuvaj nacrt</SubmitButton>
              <SubmitButton name="intent" value="publish" pendingLabel="Objavljivanje…" confirm="Objaviti ovu verziju landing strane?">Objavi verziju</SubmitButton>
              {previewHref ? <Link href={previewHref} target="_blank" className={buttonVariants({ variant: "ghost" })}>Otvori admin pregled</Link> : null}
            </div>
          </div>
          <div className="overflow-hidden rounded-2xl border border-border/60 bg-surface shadow-sm">
            <div className="relative aspect-[16/10] bg-brand-blue">
              {heroImageUrl ? <Image src={heroImageUrl} alt="" fill unoptimized className="object-cover opacity-45" /> : null}
              <div className="relative z-10 p-5 text-white"><h2 className="font-display text-2xl font-bold">{title || "Naslov landing strane"}</h2>{lead ? <p className="mt-2 line-clamp-3 text-sm text-white/85">{lead}</p> : null}</div>
            </div>
            <div className="p-4 text-xs text-ink-500">Brzi nacrt hero sekcije · {blocks.filter((block) => block.visible).length} vidljivih blokova</div>
          </div>
        </aside>
      </div>
    </AdminActionForm>
  );
}

function EditorSection({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return <section className="space-y-4 rounded-2xl border border-border/60 bg-surface p-6 shadow-sm"><div><h2 className="font-display text-xl text-ink-900">{title}</h2>{description ? <p className="mt-1 text-sm text-ink-500">{description}</p> : null}</div>{children}</section>;
}

function IconButton({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactElement<{ className?: string }> }) {
  return <button type="button" title={label} aria-label={label} disabled={disabled} onClick={onClick} className={cn("rounded-md p-1.5 text-ink-500 hover:bg-white hover:text-ink-900 disabled:opacity-30", danger && "hover:text-danger")}>{<span className="[&>svg]:size-4">{children}</span>}</button>;
}

function BlockFields({ block, pageId, pictograms, onChange }: { block: LandingBlock; pageId?: string; pictograms: PictogramOption[]; onChange: (block: LandingBlock) => void }) {
  if (block.type === "RICH_TEXT") return <><Field label="Naslov bloka (opciono)"><Input value={block.title ?? ""} onChange={(event) => onChange({ ...block, title: event.target.value || null })} /></Field><Field label="Markdown sadržaj" hint="Dozvoljeni su H2/H3, liste i bezbedni linkovi. H1 i sirovi HTML nisu dozvoljeni."><Textarea rows={12} value={block.bodyMarkdown} onChange={(event) => onChange({ ...block, bodyMarkdown: event.target.value })} className="font-mono" /></Field></>;
  if (block.type === "BANNER") return <><div className="grid gap-3 sm:grid-cols-2"><Field label="Oznaka"><Input value={block.eyebrow ?? ""} onChange={(event) => onChange({ ...block, eyebrow: event.target.value || null })} /></Field><Field label="Naslov"><Input required value={block.title} onChange={(event) => onChange({ ...block, title: event.target.value })} /></Field></div><Field label="Tekst"><Textarea rows={3} value={block.body ?? ""} onChange={(event) => onChange({ ...block, body: event.target.value || null })} /></Field><MediaUrlField pageId={pageId} label="Desktop slika" value={block.imageDesktopUrl ?? ""} onChange={(value) => onChange({ ...block, imageDesktopUrl: value || null })} /><MediaUrlField pageId={pageId} label="Mobilna slika" value={block.imageMobileUrl ?? ""} onChange={(value) => onChange({ ...block, imageMobileUrl: value || null })} /><div className="grid gap-3 sm:grid-cols-3"><Field label="Alt tekst"><Input value={block.imageAlt ?? ""} onChange={(event) => onChange({ ...block, imageAlt: event.target.value || null })} /></Field><Field label="Dugme"><Input value={block.ctaLabel ?? ""} onChange={(event) => onChange({ ...block, ctaLabel: event.target.value || null })} /></Field><Field label="Link"><Input value={block.ctaHref ?? ""} onChange={(event) => onChange({ ...block, ctaHref: event.target.value || null })} /></Field></div><ThemeField value={block.theme} onChange={(theme) => onChange({ ...block, theme })} /></>;
  if (block.type === "PRODUCT_GRID") return <><Field label="Naslov"><Input value={block.title ?? ""} onChange={(event) => onChange({ ...block, title: event.target.value || null })} /></Field><Field label="Uvod"><Textarea rows={2} value={block.body ?? ""} onChange={(event) => onChange({ ...block, body: event.target.value || null })} /></Field><ProductPicker skus={block.productSkus} onChange={(productSkus) => onChange({ ...block, productSkus })} /></>;
  if (block.type === "PICTOGRAM_ROW") return <><Field label="Naslov"><Input value={block.title ?? ""} onChange={(event) => onChange({ ...block, title: event.target.value || null })} /></Field><div className="space-y-2">{block.items.map((item, index) => <div key={`${item.pictogramId}-${index}`} className="grid gap-2 rounded-lg border border-border/60 p-2 sm:grid-cols-[1fr_1fr_1fr_auto]"><select value={item.pictogramId} onChange={(event) => onChange({ ...block, items: block.items.map((current, at) => at === index ? { ...current, pictogramId: event.target.value } : current) })} className="h-9 rounded-lg border border-input bg-surface px-2 text-sm">{pictograms.map((pictogram) => <option key={pictogram.id} value={pictogram.id}>{pictogram.label}</option>)}</select><Input placeholder="Prilagođen naziv" value={item.label ?? ""} onChange={(event) => onChange({ ...block, items: block.items.map((current, at) => at === index ? { ...current, label: event.target.value || null } : current) })} /><Input placeholder="Link (opciono)" value={item.href ?? ""} onChange={(event) => onChange({ ...block, items: block.items.map((current, at) => at === index ? { ...current, href: event.target.value || null } : current) })} /><IconButton danger label="Ukloni" onClick={() => onChange({ ...block, items: block.items.filter((_, at) => at !== index) })}><Trash2 /></IconButton></div>)}</div><Button type="button" variant="outline" disabled={!pictograms.length || block.items.length >= 8} onClick={() => pictograms[0] && onChange({ ...block, items: [...block.items, { pictogramId: pictograms[0].id, label: null, href: null }] })}><Plus className="size-4" /> Dodaj piktogram</Button></>;
  return <><Field label="Naslov"><Input value={block.title} onChange={(event) => onChange({ ...block, title: event.target.value })} /></Field><Field label="Tekst"><Textarea rows={3} value={block.body ?? ""} onChange={(event) => onChange({ ...block, body: event.target.value || null })} /></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="Naziv dugmeta"><Input value={block.ctaLabel} onChange={(event) => onChange({ ...block, ctaLabel: event.target.value })} /></Field><Field label="Link"><Input value={block.ctaHref} onChange={(event) => onChange({ ...block, ctaHref: event.target.value })} /></Field></div><ThemeField value={block.theme} onChange={(theme) => onChange({ ...block, theme })} /></>;
}

function ThemeField({ value, onChange }: { value: "LIGHT" | "DARK"; onChange: (value: "LIGHT" | "DARK") => void }) {
  return <Field label="Tema"><select value={value} onChange={(event) => onChange(event.target.value as "LIGHT" | "DARK")} className="h-9 rounded-lg border border-input bg-surface px-2 text-sm"><option value="LIGHT">Svetla</option><option value="DARK">Tamna</option></select></Field>;
}

export function MediaUrlField({ pageId, label, name, value, onChange }: { pageId?: string; label: string; name?: string; value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [media, setMedia] = useState<Array<{ name: string; url: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = async () => {
    if (!pageId) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/admin/landing-media?pageId=${encodeURIComponent(pageId)}`);
      const payload = await response.json() as { media?: Array<{ name: string; url: string }>; error?: string };
      if (!response.ok) throw new Error(payload.error || "Mediji nisu učitani.");
      setMedia(payload.media ?? []); setOpen(true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Greška."); }
    finally { setBusy(false); }
  };
  const upload = async (file: File) => {
    if (!pageId) return;
    setBusy(true); setError("");
    try {
      const data = new FormData(); data.set("pageId", pageId); data.set("file", file);
      const response = await fetch("/api/admin/landing-media", { method: "POST", body: data });
      const payload = await response.json() as { media?: { name: string; url: string }; error?: string };
      if (!response.ok || !payload.media) throw new Error(payload.error || "Upload nije uspeo.");
      setMedia((current) => [payload.media!, ...current]); onChange(payload.media.url); setOpen(true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Greška."); }
    finally { setBusy(false); }
  };
  return <div>
    <p className="mb-1.5 text-xs font-medium uppercase tracking-[0.12em] text-ink-500">{label}</p>
    <div className="flex gap-2">
      <Input name={name} aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} placeholder="https://… ili izaberite iz biblioteke" />
      <Button type="button" variant="outline" disabled={!pageId || busy} onClick={load}><ImagePlus className="size-4" /> Biblioteka</Button>
      <label className={cn(buttonVariants({ variant: "outline" }), (!pageId || busy) && "pointer-events-none opacity-50")}>
        <Plus className="size-4" /> Upload
        <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.currentTarget.value = ""; }} />
      </label>
    </div>
    {!pageId ? <p className="mt-1 text-xs text-ink-500">Prvo sačuvajte nacrt da biste otpremali slike.</p> : null}
    {error ? <p role="alert" className="mt-1 text-xs text-danger">{error}</p> : null}
    {open ? <div className="mt-2 grid max-h-56 grid-cols-3 gap-2 overflow-y-auto rounded-lg border p-2">{media.length ? media.map((item) => <button type="button" key={item.url} onClick={() => { onChange(item.url); setOpen(false); }} className="relative aspect-video overflow-hidden rounded-md border bg-muted-bg"><Image src={item.url} alt={item.name} fill unoptimized className="object-cover" /></button>) : <p className="col-span-3 p-3 text-center text-xs text-ink-500">Biblioteka je prazna.</p>}</div> : null}
  </div>;
}

function ProductPicker({ skus, onChange }: { skus: string[]; onChange: (skus: string[]) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Array<{ sku: string; name: string; slug: string; imageUrl: string }>>([]);
  const [busy, setBusy] = useState(false);
  const search = async () => {
    if (query.trim().length < 2) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/landing-products?q=${encodeURIComponent(query)}`);
      const payload = await response.json() as { products?: typeof results };
      setResults(payload.products ?? []);
    } finally { setBusy(false); }
  };
  return <div className="space-y-3"><Field label="Pretražite po nazivu ili SKU-u"><div className="flex gap-2"><Input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void search(); } }} /><Button type="button" variant="outline" disabled={busy || query.trim().length < 2} onClick={search}><Search className="size-4" /> Pretraži</Button></div></Field>{results.length ? <div className="grid gap-2 sm:grid-cols-2">{results.map((product) => <button type="button" key={product.sku} disabled={skus.includes(product.sku)} onClick={() => onChange([...skus, product.sku])} className="flex items-center gap-2 rounded-lg border p-2 text-left hover:bg-muted-bg disabled:opacity-50">{product.imageUrl ? <Image src={product.imageUrl} alt="" width={40} height={40} unoptimized className="size-10 rounded object-cover" /> : <span className="size-10 rounded bg-muted-bg" />}<span className="min-w-0"><span className="block truncate text-sm font-medium">{product.name}</span><span className="font-mono text-xs text-ink-500">{product.sku}</span></span></button>)}</div> : null}<div className="space-y-2">{skus.map((sku, index) => <div key={`${sku}-${index}`} className="flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2"><GripVertical className="size-4 text-ink-400" /><span className="flex-1 font-mono text-sm">{sku}</span><IconButton label="Gore" disabled={index === 0} onClick={() => { const next = [...skus]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; onChange(next); }}><ChevronUp /></IconButton><IconButton label="Dole" disabled={index === skus.length - 1} onClick={() => { const next = [...skus]; [next[index + 1], next[index]] = [next[index]!, next[index + 1]!]; onChange(next); }}><ChevronDown /></IconButton><IconButton label="Ukloni" danger onClick={() => onChange(skus.filter((_, at) => at !== index))}><Trash2 /></IconButton></div>)}</div>{!skus.length ? <p className="text-xs text-ink-500">Nijedan proizvod nije izabran.</p> : null}</div>;
}
