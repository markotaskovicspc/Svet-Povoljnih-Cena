"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Block =
  | { id: string; type: "heading"; text: string }
  | { id: string; type: "text"; text: string }
  | { id: string; type: "image"; url: string; alt: string; href: string }
  | { id: string; type: "button"; label: string; href: string }
  | { id: string; type: "products"; title: string; skus: string[] }
  | { id: string; type: "voucher"; code: string; text: string }
  | { id: string; type: "divider" };

const typeLabel: Record<Block["type"], string> = {
  heading: "Naslov",
  text: "Tekst",
  image: "Slika",
  button: "Dugme",
  products: "Proizvodi",
  voucher: "Vaučer",
  divider: "Razdelnik",
};

function newId(type: string) {
  return `${type}-${crypto.randomUUID()}`;
}

function createBlock(type: Block["type"]): Block {
  switch (type) {
    case "heading": return { id: newId(type), type, text: "Novi naslov" };
    case "text": return { id: newId(type), type, text: "Unesite tekst poruke." };
    case "image": return { id: newId(type), type, url: "", alt: "", href: "" };
    case "button": return { id: newId(type), type, label: "Pogledaj ponudu", href: "/akcija" };
    case "products": return { id: newId(type), type, title: "Izdvajamo", skus: [] };
    case "voucher": return { id: newId(type), type, code: "", text: "" };
    case "divider": return { id: newId(type), type };
  }
}

function normalizeBlocks(input: unknown): Block[] {
  return Array.isArray(input) ? input as Block[] : [];
}

export function NewsletterBlockEditor({
  initialContent,
  products,
}: {
  initialContent: unknown;
  products: Array<{ sku: string; name: string }>;
}) {
  const [blocks, setBlocks] = useState<Block[]>(() => normalizeBlocks(initialContent));
  const [nextType, setNextType] = useState<Block["type"]>("text");
  const json = useMemo(() => JSON.stringify(blocks), [blocks]);

  function update<T extends Block>(id: string, patch: Partial<T>) {
    setBlocks((current) => current.map((block) => block.id === id ? { ...block, ...patch } as Block : block));
  }

  function move(index: number, direction: -1 | 1) {
    setBlocks((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const copy = [...current];
      [copy[index], copy[target]] = [copy[target]!, copy[index]!];
      return copy;
    });
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(300px,.9fr)]">
      <div className="space-y-3">
        <input type="hidden" name="content" value={json} />
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-muted-bg/50 p-3">
          <select
            value={nextType}
            onChange={(event) => setNextType(event.target.value as Block["type"])}
            className="h-8 rounded-lg border border-input bg-surface px-2 text-sm"
          >
            {(Object.keys(typeLabel) as Block["type"][]).map((type) => <option key={type} value={type}>{typeLabel[type]}</option>)}
          </select>
          <Button type="button" variant="outline" size="sm" onClick={() => setBlocks((current) => [...current, createBlock(nextType)])}>
            + Dodaj blok
          </Button>
          <span className="text-xs text-ink-500">Redosled blokova je redosled u mejlu.</span>
        </div>

        {blocks.length === 0 ? <p className="rounded-xl border border-dashed p-6 text-center text-sm text-ink-500">Dodajte bar jedan blok sadržaja.</p> : null}
        {blocks.map((block, index) => (
          <div key={block.id} className="rounded-xl border border-border/70 bg-surface p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-500">{index + 1}. {typeLabel[block.type]}</span>
              <div className="flex gap-1">
                <Button type="button" variant="ghost" size="sm" disabled={index === 0} onClick={() => move(index, -1)} aria-label="Pomeri gore">↑</Button>
                <Button type="button" variant="ghost" size="sm" disabled={index === blocks.length - 1} onClick={() => move(index, 1)} aria-label="Pomeri dole">↓</Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setBlocks((current) => current.filter((item) => item.id !== block.id))}>Ukloni</Button>
              </div>
            </div>
            {block.type === "heading" ? <Input value={block.text} onChange={(event) => update(block.id, { text: event.target.value })} placeholder="Naslov" /> : null}
            {block.type === "text" ? <Textarea value={block.text} onChange={(event) => update(block.id, { text: event.target.value })} rows={5} placeholder="Tekst poruke" /> : null}
            {block.type === "image" ? (
              <div className="grid gap-2 md:grid-cols-2">
                <Input value={block.url} onChange={(event) => update(block.id, { url: event.target.value })} placeholder="https://… URL slike" />
                <Input value={block.alt} onChange={(event) => update(block.id, { alt: event.target.value })} placeholder="Opis slike (alt)" />
                <Input className="md:col-span-2" value={block.href} onChange={(event) => update(block.id, { href: event.target.value })} placeholder="Opcioni link slike" />
              </div>
            ) : null}
            {block.type === "button" ? (
              <div className="grid gap-2 md:grid-cols-2">
                <Input value={block.label} onChange={(event) => update(block.id, { label: event.target.value })} placeholder="Tekst dugmeta" />
                <Input value={block.href} onChange={(event) => update(block.id, { href: event.target.value })} placeholder="/ponuda ili https://…" />
              </div>
            ) : null}
            {block.type === "products" ? (
              <div className="space-y-2">
                <Input value={block.title} onChange={(event) => update(block.id, { title: event.target.value })} placeholder="Naslov sekcije" />
                <Textarea
                  value={block.skus.join("\n")}
                  onChange={(event) => update(block.id, { skus: event.target.value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean).slice(0, 6) })}
                  rows={4}
                  placeholder="Jedan SKU po redu (najviše 6)"
                />
                <p className="text-xs text-ink-500">Proizvodi koji nisu aktivni ili ručno dostupni za web biće blokirani pre slanja.</p>
              </div>
            ) : null}
            {block.type === "voucher" ? (
              <div className="grid gap-2 md:grid-cols-2">
                <Input value={block.code} onChange={(event) => update(block.id, { code: event.target.value.toUpperCase() })} placeholder="KOD" />
                <Input value={block.text} onChange={(event) => update(block.id, { text: event.target.value })} placeholder="Uslovi ili objašnjenje" />
              </div>
            ) : null}
            {block.type === "divider" ? <hr className="border-border" /> : null}
          </div>
        ))}
      </div>

      <div className="xl:sticky xl:top-6 xl:self-start">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-ink-500">Brzi pregled sadržaja</p>
        <div className="max-h-[760px] overflow-y-auto rounded-2xl border bg-[#faf7f2] p-4 shadow-inner">
          <div className="mx-auto max-w-[560px] rounded-2xl bg-white p-6">
            {blocks.map((block) => <BlockPreview key={block.id} block={block} products={products} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

function BlockPreview({ block, products }: { block: Block; products: Array<{ sku: string; name: string }> }) {
  switch (block.type) {
    case "heading": return <h2 className="mb-4 font-display text-2xl">{block.text || "Naslov"}</h2>;
    case "text": return <p className="mb-5 whitespace-pre-line text-sm leading-6 text-ink-700">{block.text}</p>;
    case "image":
      // Admin email previews accept arbitrary remote URLs; Next Image's
      // deployment-time host allowlist is intentionally not applicable here.
      // eslint-disable-next-line @next/next/no-img-element
      return block.url ? <div className="mb-5 overflow-hidden rounded-xl bg-muted-bg"><img src={block.url} alt={block.alt} className="h-auto w-full" /></div> : <div className="mb-5 rounded-xl bg-muted-bg p-8 text-center text-xs text-ink-500">Slika</div>;
    case "button": return <div className="mb-5"><span className="inline-block rounded-full bg-ink-900 px-5 py-3 text-sm font-semibold text-white">{block.label}</span></div>;
    case "divider": return <hr className="my-6 border-border" />;
    case "voucher": return <div className="mb-5 rounded-xl border border-dashed border-walnut bg-canvas p-4 text-center"><p className="font-mono text-xl font-bold">{block.code || "KOD"}</p><p className="text-xs text-ink-500">{block.text}</p></div>;
    case "products": return <div className="mb-5"><h3 className="mb-2 font-display text-lg">{block.title}</h3><div className="grid grid-cols-2 gap-2">{block.skus.map((sku) => <div key={sku} className="rounded-lg bg-muted-bg p-3 text-xs"><strong>{sku}</strong><br />{products.find((product) => product.sku === sku)?.name ?? "Proizvod će biti proveren pri čuvanju"}</div>)}</div></div>;
  }
}
