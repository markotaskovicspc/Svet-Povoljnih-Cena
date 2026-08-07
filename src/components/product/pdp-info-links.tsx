"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { CmsMarkdown } from "@/components/content/cms-markdown";
import { cn } from "@/lib/utils";
import { sanitizeRichText } from "@/lib/rich-text";
import type { ProductAttachment, TechnicalSpecification } from "@/types";

export type PdpInfoKey =
  | "description"
  | "deliveryTerms"
  | "declaration"
  | "assemblyInstructions"
  | "maintenance";

const LABELS: Record<PdpInfoKey, string> = {
  description: "Opis proizvoda",
  deliveryTerms: "Uslovi isporuke",
  declaration: "Deklaracija",
  assemblyInstructions: "Uputstvo za sastavljanje",
  maintenance: "Kako održavati",
};

export function PdpInfoLinks({
  sections,
  descriptionPreview,
  standardDeliveryTermsMarkdown,
  attachments = {},
  technicalSpecs = [],
}: {
  sections: Partial<Record<PdpInfoKey, string>>;
  descriptionPreview?: string;
  standardDeliveryTermsMarkdown?: string;
  attachments?: Partial<Record<PdpInfoKey, ProductAttachment[]>>;
  technicalSpecs?: TechnicalSpecification[];
}) {
  const deliveryTerms = resolveDeliveryTermsContent(
    sections.deliveryTerms,
    standardDeliveryTermsMarkdown,
  );
  const items = (Object.keys(LABELS) as PdpInfoKey[]).map((key) => ({
    key,
    label: LABELS[key],
    content:
      key === "deliveryTerms"
        ? deliveryTerms.content
        : sections[key]?.trim() || defaultContent(key),
    format:
      key === "deliveryTerms" ? deliveryTerms.format : ("richText" as const),
    attachments: attachments[key] ?? [],
  }));
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<PdpInfoKey>("description");

  function show(key: PdpInfoKey) {
    setExpanded(key);
    setOpen(true);
  }

  return (
    <>
      {descriptionPreview ? (
        <button
          type="button"
          onClick={() => show("description")}
          className="group hidden w-full rounded-md text-left transition focus-visible:ring-2 focus-visible:ring-brand-blue/35 focus-visible:outline-none md:block"
        >
          <h2 className="font-display text-xl font-bold text-ink-900 transition group-hover:text-brand-blue md:text-2xl">
            Opis proizvoda
          </h2>
          <p className="mt-2 line-clamp-3 text-justify text-sm leading-relaxed text-ink-700">
            {descriptionPreview} ...
          </p>
        </button>
      ) : null}
      <div
        className={cn(
          "border-border/70 divide-border/70 divide-y border-y",
          descriptionPreview && "mt-3 md:mt-2",
        )}
      >
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => show(item.key)}
            className={cn(
              "group flex min-h-12 w-full items-center justify-between gap-4 py-2.5 text-left text-base font-semibold text-ink-900 transition hover:text-brand-blue focus-visible:ring-2 focus-visible:ring-brand-blue/35 focus-visible:outline-none md:min-h-13 md:py-3 md:text-sm",
              descriptionPreview && item.key === "description" && "md:hidden",
            )}
          >
            <span>{item.label}</span>
            <ChevronDown
              className="size-4 -rotate-90 text-ink-500 transition group-hover:text-brand-blue"
              aria-hidden
            />
          </button>
        ))}
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="h-[100dvh] w-[92vw] max-w-none gap-0 bg-white p-0 data-[side=right]:w-[92vw] data-[side=right]:sm:max-w-none md:data-[side=right]:w-[min(52vw,46rem)]"
        >
          <SheetHeader className="border-border/60 border-b px-5 pt-5 pb-4">
            <SheetTitle className="font-display text-xl font-bold text-ink-900">
              Informacije o proizvodu
            </SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto p-5">
            {items.map((item) => {
              const isExpanded = expanded === item.key;
              return (
                <section key={item.key} className="border-border/60 border-b last:border-0">
                  <button
                    type="button"
                    onClick={() => setExpanded(item.key)}
                    aria-expanded={isExpanded}
                    className="flex w-full items-center justify-between gap-3 py-4 text-left text-sm font-bold text-ink-900"
                  >
                    {item.label}
                    <ChevronDown
                      className={cn("size-4 text-ink-500 transition", isExpanded && "rotate-180")}
                      aria-hidden
                    />
                  </button>
                  {isExpanded ? (
                    <div className="pb-4">
                      {item.format === "markdown" ? (
                        <CmsMarkdown markdown={item.content} variant="compact" />
                      ) : (
                        <RichText content={item.content} />
                      )}
                      {item.key === "description" && technicalSpecs.length ? (
                        <TechnicalSpecs specs={technicalSpecs} />
                      ) : null}
                      {item.attachments.length ? (
                        <ul className="mt-1 space-y-2 border-t border-border/60 pt-3">
                          {item.attachments.map((attachment) => (
                            <li key={`${attachment.kind}-${attachment.url}`}>
                              <a
                                href={attachment.url}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center justify-between rounded-xl border border-border/70 bg-surface px-3 py-2.5 text-sm font-semibold text-brand-blue transition hover:border-brand-blue/40"
                              >
                                {attachment.label}
                                <span aria-hidden>↗</span>
                              </a>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function TechnicalSpecs({ specs }: { specs: TechnicalSpecification[] }) {
  return (
    <dl className="mt-5 divide-y divide-border/70 rounded-xl border border-border/70 px-3">
      {specs.map((spec) => (
        <div
          key={spec.key}
          className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4 py-2.5 text-sm"
        >
          <dt className="text-ink-500">{spec.label}</dt>
          <dd className="text-right font-medium text-ink-900">{spec.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function resolveDeliveryTermsContent(
  override: string | undefined,
  standardMarkdown: string | undefined,
) {
  const overrideContent = override?.trim();
  if (overrideContent) {
    return { content: overrideContent, format: "richText" as const };
  }
  const standardContent = standardMarkdown?.trim();
  if (standardContent) {
    return { content: standardContent, format: "markdown" as const };
  }
  return {
    content: defaultContent("deliveryTerms"),
    format: "richText" as const,
  };
}

function defaultContent(key: PdpInfoKey) {
  switch (key) {
    case "description":
      return "Opis proizvoda će biti prikazan čim se unese u administraciji.";
    case "deliveryTerms":
      return "Rok i način isporuke zavise od adrese, raspoloživosti artikla i izabranog načina dostave. Konačan obračun prikazuje se u checkout-u.";
    case "declaration":
      return "Deklaracija je dostupna u administraciji proizvoda i biće prikazana čim se unese za ovaj artikal.";
    case "assemblyInstructions":
      return "Uputstvo za sastavljanje je dostupno za proizvode koji zahtevaju montažu. Ako proizvod ne zahteva montažu, ovaj odeljak je informativan.";
    case "maintenance":
      return "Održavajte proizvod prema materijalu i nameni. Koristite blaga sredstva i izbegavajte abrazivne površine.";
  }
}

function RichText({ content }: { content: string }) {
  const hasMarkup = /<\/?[a-z][\s\S]*>/i.test(content);
  if (hasMarkup) {
    return (
      <div
        className="text-justify text-sm leading-relaxed text-ink-700 [&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:border-walnut/35 [&_blockquote]:pl-4 [&_blockquote]:italic [&_em]:italic [&_h2]:mt-5 [&_h2]:mb-3 [&_h2]:text-left [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-ink-900 [&_h2:first-child]:mt-0 [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-left [&_h3]:text-base [&_h3]:font-bold [&_h3]:text-ink-900 [&_li]:mb-1 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-3 [&_p:last-child]:mb-0 [&_strong]:font-bold [&_u]:underline [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5"
        dangerouslySetInnerHTML={{ __html: sanitizeRichText(content) }}
      />
    );
  }
  return (
    <div className="text-justify text-sm leading-relaxed whitespace-pre-line text-ink-700">
      {content}
    </div>
  );
}
