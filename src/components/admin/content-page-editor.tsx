"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { AdminActionState } from "@/lib/admin/action-state";
import { AdminActionForm } from "@/components/admin/action-form";
import { Field } from "@/components/admin/field";
import { SubmitButton } from "@/components/admin/submit-button";
import { CmsMarkdown } from "@/components/content/cms-markdown";
import { ContactChannels } from "@/components/content/contact-channels";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  CONTENT_FOOTER_COLUMNS,
  contentPreviewPath,
} from "@/lib/cms/constants";
import { validateCmsMarkdown } from "@/lib/cms/markdown";
import type {
  ContactChannel,
  ContactPageWidgetData,
} from "@/lib/cms/contact-page";

type ContentPageEditorValues = {
  id?: string;
  revisionId: string | null;
  slug: string;
  kind: "SYSTEM" | "CUSTOM";
  template: "STANDARD" | "FAQ";
  eyebrow: string | null;
  heroNote: string | null;
  title: string;
  lead: string | null;
  bodyMarkdown: string;
  seoTitle: string | null;
  seoDescription: string | null;
  widgetData: ContactPageWidgetData | null;
  footerVisible: boolean;
  footerLabel: string | null;
  footerColumn: "COMPANY" | "TERMS" | null;
  footerOrder: number | null;
  lockedSlug: boolean;
};

const subscribeToClientRuntime = () => () => {};

function useClientReady() {
  return useSyncExternalStore(
    subscribeToClientRuntime,
    () => true,
    () => false,
  );
}

export function ContentPageEditor({
  action,
  values,
  previewHref,
}: {
  action: (state: AdminActionState, formData: FormData) => Promise<AdminActionState>;
  values: ContentPageEditorValues;
  previewHref?: string;
}) {
  return (
    <AdminActionForm action={action} className="space-y-6">
      <ContentPageEditorFields
        key={values.revisionId ?? `new-${values.id ?? "page"}`}
        values={values}
        previewHref={previewHref}
      />
    </AdminActionForm>
  );
}

function ContentPageEditorFields({
  values,
  previewHref,
}: {
  values: ContentPageEditorValues;
  previewHref?: string;
}) {
  const clientReady = useClientReady();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [slug, setSlug] = useState(values.slug);
  const [eyebrow, setEyebrow] = useState(values.eyebrow ?? "");
  const [heroNote, setHeroNote] = useState(values.heroNote ?? "");
  const [title, setTitle] = useState(values.title);
  const [lead, setLead] = useState(values.lead ?? "");
  const [bodyMarkdown, setBodyMarkdown] = useState(values.bodyMarkdown);
  const [seoTitle, setSeoTitle] = useState(values.seoTitle ?? "");
  const [seoDescription, setSeoDescription] = useState(values.seoDescription ?? "");
  const [widgetData, setWidgetData] = useState(values.widgetData);
  const [footerVisible, setFooterVisible] = useState(values.footerVisible);
  const [footerLabel, setFooterLabel] = useState(
    values.footerLabel ?? values.title.replace(/[.]$/, ""),
  );
  const [footerColumn, setFooterColumn] = useState<"COMPANY" | "TERMS">(
    values.footerColumn ?? "COMPANY",
  );
  const [footerOrder, setFooterOrder] = useState(
    String(values.footerOrder ?? 100),
  );
  const issues = useMemo(() => validateCmsMarkdown(bodyMarkdown), [bodyMarkdown]);

  const insertMarkdown = (before: string, after = "", placeholder = "tekst") => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = bodyMarkdown.slice(start, end) || placeholder;
    const next = `${bodyMarkdown.slice(0, start)}${before}${selected}${after}${bodyMarkdown.slice(end)}`;
    setBodyMarkdown(next);
    requestAnimationFrame(() => {
      textarea.focus();
      const cursor = start + before.length + selected.length + after.length;
      textarea.setSelectionRange(cursor, cursor);
    });
  };

  const updateContactChannel = (
    id: ContactChannel["id"],
    patch: Partial<Omit<ContactChannel, "id">>,
  ) => {
    setWidgetData((current) =>
      current
        ? {
            ...current,
            channels: current.channels.map((channel) =>
              channel.id === id ? { ...channel, ...patch } : channel,
            ),
          }
        : current,
    );
  };

  return (
    <fieldset className="contents" disabled={!clientReady}>
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.82fr)]">
        <div className="space-y-6">
          <section className="rounded-2xl border border-border/60 bg-surface p-6 shadow-sm">
            <h2 className="font-display text-xl text-ink-900">Osnovni podaci</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field label="Slug">
                <Input
                  name="slug"
                  required
                  value={slug}
                  onChange={(event) => setSlug(event.target.value)}
                  readOnly={values.lockedSlug}
                  className={values.lockedSlug ? "bg-muted-bg text-ink-500" : undefined}
                />
              </Field>
              <Field label="Oznaka iznad naslova">
                <Input
                  name="eyebrow"
                  value={eyebrow}
                  onChange={(event) => setEyebrow(event.target.value)}
                  placeholder="Pravila, Naša priča…"
                />
              </Field>
            </div>
            {values.lockedSlug ? (
              <p className="mt-2 text-xs text-ink-500">
                Slug je zaključan jer je stranica sistemska ili je već bila objavljena.
              </p>
            ) : null}
            <div className="mt-4 space-y-4">
              <Field label="Naslov">
                <Input
                  name="title"
                  required
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </Field>
              <Field label="Uvodni tekst">
                <Textarea
                  name="lead"
                  rows={3}
                  value={lead}
                  onChange={(event) => setLead(event.target.value)}
                />
              </Field>
              <Field label="Napomena ispod uvoda">
                <Input
                  name="heroNote"
                  value={heroNote}
                  onChange={(event) => setHeroNote(event.target.value)}
                  placeholder="Poslednje izmene: 28. jul 2026."
                />
              </Field>
            </div>
          </section>

          {widgetData ? (
            <section className="rounded-2xl border border-border/60 bg-surface p-6 shadow-sm">
              <h2 className="font-display text-xl text-ink-900">Kontakt kartice</h2>
              <p className="mt-1 text-sm text-ink-500">
                Menjajte četiri kartice prikazane iznad glavnog sadržaja kontakt strane.
                Link se automatski pravi kao e-pošta ili Google Maps adresa.
              </p>
              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                {widgetData.channels.map((channel) => (
                  <div
                    key={channel.id}
                    className="rounded-xl border border-border/60 bg-muted-bg/25 p-4"
                  >
                    <label className="flex items-center gap-2 text-sm font-medium text-ink-900">
                      <input
                        type="checkbox"
                        name={`contact-${channel.id}-enabled`}
                        checked={channel.enabled}
                        onChange={(event) =>
                          updateContactChannel(channel.id, {
                            enabled: event.target.checked,
                          })
                        }
                        className="size-4 accent-walnut"
                      />
                      Prikaži karticu
                    </label>
                    <div className="mt-4 space-y-3">
                      <Field label="Naziv kartice">
                        <Input
                          name={`contact-${channel.id}-label`}
                          value={channel.label}
                          onChange={(event) =>
                            updateContactChannel(channel.id, {
                              label: event.target.value,
                            })
                          }
                          maxLength={80}
                        />
                      </Field>
                      <Field
                        label="Glavna vrednost"
                        hint={
                          channel.id === "email"
                            ? "Adresa e-pošte"
                            : "Adresa koja se otvara u Google Maps"
                        }
                      >
                        <Input
                          name={`contact-${channel.id}-value`}
                          type={channel.id === "email" ? "email" : "text"}
                          value={channel.value}
                          onChange={(event) =>
                            updateContactChannel(channel.id, {
                              value: event.target.value,
                            })
                          }
                          maxLength={300}
                        />
                      </Field>
                      <Field label="Napomena">
                        <Textarea
                          name={`contact-${channel.id}-note`}
                          rows={2}
                          value={channel.note}
                          onChange={(event) =>
                            updateContactChannel(channel.id, {
                              note: event.target.value,
                            })
                          }
                          maxLength={500}
                        />
                      </Field>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="rounded-2xl border border-border/60 bg-surface p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-xl text-ink-900">Markdown sadržaj</h2>
                <p className="mt-1 text-sm text-ink-500">
                  Za stabilan link koristite, na primer, ## Načini plaćanja {"{#kartice}"}.
                </p>
              </div>
              <span className="rounded-full bg-muted-bg px-2.5 py-1 text-xs text-ink-500">
                {bodyMarkdown.length.toLocaleString("sr-Latn-RS")} / 60.000
              </span>
            </div>
            <div className="mt-4 flex flex-wrap gap-2" aria-label="Markdown alatke">
              <Button type="button" variant="outline" size="sm" onClick={() => insertMarkdown("## ", " {#sekcija}\n\n", "Naslov sekcije")}>H2</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => insertMarkdown("### ", " {#pitanje}\n\n", "Pitanje")}>H3</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => insertMarkdown("**", "**")}>Bold</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => insertMarkdown("*", "*")}>Italic</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => insertMarkdown("- ", "", "stavka")}>Lista</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => insertMarkdown("[", "](https://)", "tekst linka")}>Link</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => insertMarkdown("{{merchant.name}}", "", "")}>Naziv firme</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => insertMarkdown("{{merchant.pib}}", "", "")}>PIB</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => insertMarkdown("{{merchant.email}}", "", "")}>E-pošta</Button>
            </div>
            <Textarea
              ref={textareaRef}
              name="bodyMarkdown"
              required
              rows={24}
              value={bodyMarkdown}
              onChange={(event) => setBodyMarkdown(event.target.value)}
              className="mt-3 min-h-[560px] font-mono text-sm leading-relaxed"
            />
            {issues.length ? (
              <div className="mt-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-ink-700">
                <p className="font-medium">Nacrt može da se sačuva, ali objava je blokirana:</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {issues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}
                </ul>
              </div>
            ) : null}
          </section>

          <section className="rounded-2xl border border-border/60 bg-surface p-6 shadow-sm">
            <h2 className="font-display text-xl text-ink-900">SEO</h2>
            <div className="mt-5 space-y-4">
              <Field label="SEO naslov">
                <Input
                  name="seoTitle"
                  value={seoTitle}
                  onChange={(event) => setSeoTitle(event.target.value)}
                  placeholder={title || "Naslov stranice"}
                />
              </Field>
              <Field label="SEO opis">
                <Textarea
                  name="seoDescription"
                  rows={3}
                  value={seoDescription}
                  onChange={(event) => setSeoDescription(event.target.value)}
                />
              </Field>
              <div className="rounded-xl border border-border/60 bg-white p-4">
                <p className="text-lg text-[#1a0dab]">{seoTitle || title || "Naslov stranice"}</p>
                <p className="mt-1 text-sm text-[#006621]">
                  www.svetpovoljnihcena.rs{contentPreviewPath(slug)}
                </p>
                <p className="mt-1 text-sm text-[#4d5156]">{seoDescription || lead || "SEO opis stranice."}</p>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-border/60 bg-surface p-6 shadow-sm">
            <h2 className="font-display text-xl text-ink-900">Footer</h2>
            <label className="mt-4 flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                name="footerVisible"
                checked={footerVisible}
                onChange={(event) => setFooterVisible(event.target.checked)}
                className="size-4 accent-walnut"
              />
              Prikaži ovu stranicu u footeru
            </label>
            {footerVisible ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <Field label="Naziv linka">
                  <Input
                    name="footerLabel"
                    value={footerLabel}
                    onChange={(event) => setFooterLabel(event.target.value)}
                  />
                </Field>
                <Field label="Kolona">
                  <select
                    name="footerColumn"
                    value={footerColumn}
                    onChange={(event) =>
                      setFooterColumn(event.target.value as "COMPANY" | "TERMS")
                    }
                    className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  >
                    {CONTENT_FOOTER_COLUMNS.map((column) => (
                      <option key={column.value} value={column.value}>{column.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Redosled">
                  <Input
                    name="footerOrder"
                    type="number"
                    min={0}
                    max={9999}
                    value={footerOrder}
                    onChange={(event) => setFooterOrder(event.target.value)}
                  />
                </Field>
              </div>
            ) : null}
          </section>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <div className="overflow-hidden rounded-2xl border border-border/60 bg-surface shadow-sm">
            <div className="border-b border-border/60 bg-muted-bg/50 px-4 py-3">
              <p className="text-sm font-medium text-ink-900">Javni pregled nacrta</p>
            </div>
            <div className="max-h-[72vh] overflow-y-auto">
              <div className="border-b border-border/60 bg-muted-bg/60 px-6 py-8">
                {eyebrow ? <p className="font-mono text-xs tracking-wide text-walnut uppercase">{eyebrow}</p> : null}
                <h1 className="mt-2 font-display text-3xl font-bold text-ink-900">{title || "Naslov stranice"}</h1>
                {lead ? <p className="mt-3 text-sm leading-relaxed text-ink-700">{lead}</p> : null}
                {heroNote ? <p className="mt-4 font-mono text-[10px] tracking-wide text-ink-500 uppercase">{heroNote}</p> : null}
              </div>
              <div className="pointer-events-none px-6 py-8 text-sm text-ink-700 [&_p]:mt-3 [&_p]:leading-relaxed [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mt-3 [&_ol]:list-decimal [&_ol]:pl-5">
                {widgetData ? (
                  <div className="mb-8">
                    <ContactChannels data={widgetData} />
                  </div>
                ) : null}
                <CmsMarkdown markdown={bodyMarkdown} template={values.template} />
              </div>
            </div>
          </div>
        </aside>
      </div>

      <div className="sticky bottom-4 z-20 flex flex-wrap items-center gap-3 rounded-2xl border border-border/70 bg-surface/95 p-4 shadow-lg backdrop-blur">
        <SubmitButton name="intent" value="save" pendingLabel="Čuvanje…">
          Sačuvaj nacrt
        </SubmitButton>
        {previewHref ? (
          <Link
            href={previewHref}
            target="_blank"
            className={buttonVariants({ variant: "outline" })}
          >
            Pregledaj
          </Link>
        ) : null}
        <SubmitButton
          name="intent"
          value="publish"
          variant="default"
          pendingLabel="Objavljivanje…"
          disabled={issues.length > 0}
          confirm="Objaviti ovu verziju na javnom sajtu?"
        >
          Objavi
        </SubmitButton>
        <p className="ml-auto text-xs text-ink-500">
          Čuvanje nacrta ne menja javni sajt.
        </p>
      </div>
    </fieldset>
  );
}
