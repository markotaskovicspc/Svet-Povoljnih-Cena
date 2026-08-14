"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { ChevronDown, ChevronUp, Search } from "lucide-react";
import type { AdminActionState } from "@/lib/admin/action-state";
import { AdminActionForm } from "@/components/admin/action-form";
import { Field } from "@/components/admin/field";
import { SubmitButton } from "@/components/admin/submit-button";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type AdminFormAction = (
  state: AdminActionState,
  formData: FormData,
) => Promise<AdminActionState>;

export type ProductColorFamilyManagerMember = {
  productId: string;
  sku: string;
  name: string;
  label: string;
  colorPrimary: string | null;
  colorSecondary: string | null;
  imageUrl: string;
  priceLabel: string;
  stock: number;
  isPrimary: boolean;
  storefrontEnabled: boolean;
  readinessReasons: string[];
};

type Candidate = {
  id: string;
  sku: string;
  name: string;
  colorPrimary: string | null;
  colorSecondary: string | null;
  imageUrl: string;
  familyCode: string | null;
  alreadyInCurrentFamily: boolean;
  canLink: boolean;
  readinessReasons: string[];
};

export function ProductColorFamilyManager({
  source,
  familyCode,
  members,
  colorOptions,
  updateMemberAction,
  linkExistingAction,
  createDraftAction,
  moveAction,
  setPrimaryAction,
  toggleStorefrontAction,
  detachAction,
}: {
  source: {
    id: string;
    sku: string;
    colorPrimary: string | null;
    colorSecondary: string | null;
  };
  familyCode: string | null;
  members: ProductColorFamilyManagerMember[];
  colorOptions: string[];
  updateMemberAction: AdminFormAction;
  linkExistingAction: AdminFormAction;
  createDraftAction: AdminFormAction;
  moveAction: AdminFormAction;
  setPrimaryAction: AdminFormAction;
  toggleStorefrontAction: AdminFormAction;
  detachAction: AdminFormAction;
}) {
  const colorListId = useId();
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState("");

  useEffect(() => {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length < 2) {
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setSearchError("");
      try {
        const response = await fetch(
          `/api/admin/products/family-candidates?q=${encodeURIComponent(normalizedQuery)}&sourceProductId=${encodeURIComponent(source.id)}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("Pretraga trenutno nije dostupna.");
        const payload = (await response.json()) as { products?: Candidate[] };
        setCandidates(payload.products ?? []);
        setSelected((current) =>
          current && payload.products?.some((candidate) => candidate.id === current.id)
            ? current
            : null,
        );
      } catch (error) {
        if (controller.signal.aborted) return;
        setCandidates([]);
        setSelected(null);
        setSearchError(
          error instanceof Error ? error.message : "Pretraga trenutno nije dostupna.",
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, source.id]);

  const sourceHasColor = Boolean(source.colorPrimary?.trim());

  return (
    <div className="mt-4 space-y-5">
      <datalist id={colorListId}>
        {colorOptions.map((color) => (
          <option key={color} value={color} />
        ))}
      </datalist>

      <div className="rounded-lg border border-border/70 bg-muted-bg/35 px-3 py-2 text-xs text-ink-600">
        {familyCode ? (
          <>
            Interna porodica <span className="font-mono font-semibold">{familyCode}</span>.
            Naziv varijante se automatski izvodi iz polja Boja 1 i Boja 2.
          </>
        ) : (
          <>
            Porodica će biti automatski napravljena pri prvom povezivanju, bez
            ručnog unosa interne šifre.
          </>
        )}
      </div>

      {!sourceHasColor ? (
        <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          Najpre sačuvajte Boju 1 za SKU {source.sku}; tek tada može da postane
          glavni član porodice.
        </p>
      ) : null}

      {members.length ? (
        <div className="space-y-2">
          {members.map((member, index) => (
            <div
              key={member.productId}
              className="rounded-xl border border-border/70 bg-background p-3"
            >
              <div className="grid grid-cols-[56px_minmax(0,1fr)] gap-3 lg:grid-cols-[56px_minmax(0,1fr)_auto] lg:items-center">
                <div className="relative size-14 overflow-hidden rounded-lg bg-[linear-gradient(135deg,#f2f0eb_0_50%,#e5e2db_50%)] ring-1 ring-border">
                  {member.imageUrl ? (
                    <Image
                      src={member.imageUrl}
                      alt=""
                      fill
                      sizes="56px"
                      className="object-contain p-1"
                    />
                  ) : (
                    <span className="absolute inset-0 grid place-items-center text-[10px] font-medium text-ink-400">
                      Bez slike
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink-900">
                    {member.label} {member.isPrimary ? "· glavna boja" : ""}
                  </p>
                  <p className="truncate text-xs text-ink-500">
                    {member.sku} · {member.priceLabel} · stanje {member.stock}
                  </p>
                  <p
                    className={
                      member.storefrontEnabled
                        ? "mt-1 text-xs font-medium text-success"
                        : "mt-1 text-xs font-medium text-warning"
                    }
                  >
                    {member.storefrontEnabled
                      ? "Objavljena boja"
                      : "Boja je skrivena sa weba"}
                  </p>
                </div>
                <div className="col-span-2 flex flex-wrap items-center gap-1.5 lg:col-span-1 lg:justify-end">
                  <AdminActionForm action={moveAction} refreshOnSuccess>
                    <input type="hidden" name="productId" value={member.productId} />
                    <input type="hidden" name="direction" value="up" />
                    <SubmitButton
                      variant="outline"
                      size="icon-xs"
                      aria-label={`Pomeri ${member.label} gore`}
                      title="Pomeri gore"
                      disabled={index === 0}
                    >
                      <ChevronUp />
                    </SubmitButton>
                  </AdminActionForm>
                  <AdminActionForm action={moveAction} refreshOnSuccess>
                    <input type="hidden" name="productId" value={member.productId} />
                    <input type="hidden" name="direction" value="down" />
                    <SubmitButton
                      variant="outline"
                      size="icon-xs"
                      aria-label={`Pomeri ${member.label} dole`}
                      title="Pomeri dole"
                      disabled={index === members.length - 1}
                    >
                      <ChevronDown />
                    </SubmitButton>
                  </AdminActionForm>
                  {!member.isPrimary ? (
                    <AdminActionForm action={setPrimaryAction} refreshOnSuccess>
                      <input type="hidden" name="productId" value={member.productId} />
                      <SubmitButton variant="outline" size="xs">
                        Postavi glavnu
                      </SubmitButton>
                    </AdminActionForm>
                  ) : null}
                  <AdminActionForm action={toggleStorefrontAction} refreshOnSuccess>
                    <input type="hidden" name="productId" value={member.productId} />
                    <input
                      type="hidden"
                      name="enabled"
                      value={member.storefrontEnabled ? "false" : "true"}
                    />
                    <SubmitButton
                      variant={member.storefrontEnabled ? "outline" : "secondary"}
                      size="xs"
                      disabled={
                        !member.storefrontEnabled && member.readinessReasons.length > 0
                      }
                      title={
                        !member.storefrontEnabled && member.readinessReasons.length
                          ? member.readinessReasons.join("; ")
                          : undefined
                      }
                    >
                      {member.storefrontEnabled ? "Sakrij sa weba" : "Objavi boju"}
                    </SubmitButton>
                  </AdminActionForm>
                  <Link
                    href={`/admin/erp/artikli/${member.productId}`}
                    className="inline-flex h-6 items-center rounded-md border border-border px-2 text-xs font-medium hover:bg-muted-bg"
                  >
                    Uredi SKU
                  </Link>
                  <AdminActionForm action={detachAction} refreshOnSuccess>
                    <input type="hidden" name="productId" value={member.productId} />
                    <SubmitButton
                      variant="destructive"
                      size="xs"
                      confirm={`Odvojiti SKU ${member.sku} iz porodice? Artikal i njegova istorija neće biti obrisani.`}
                    >
                      Odvoji
                    </SubmitButton>
                  </AdminActionForm>
                </div>
              </div>
              {member.readinessReasons.length ? (
                <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-warning">
                  {member.readinessReasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              ) : null}
              <AdminActionForm
                action={updateMemberAction}
                refreshOnSuccess
                className="mt-3 grid gap-2 border-t border-border/60 pt-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
              >
                <input type="hidden" name="productId" value={member.productId} />
                <Field label={`Boja 1 · ${member.sku}`}>
                  <Input
                    name="colorPrimary"
                    required
                    list={colorListId}
                    defaultValue={member.colorPrimary ?? ""}
                  />
                </Field>
                <Field label="Boja 2 (opciono)">
                  <Input
                    name="colorSecondary"
                    list={colorListId}
                    defaultValue={member.colorSecondary ?? ""}
                  />
                </Field>
                <SubmitButton variant="outline" size="sm">
                  Sačuvaj boje
                </SubmitButton>
              </AdminActionForm>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-ink-500">
            Ovaj SKU još nema porodicu boja. Sačuvajte njegovu osnovnu boju, pa
            povežite postojeći artikal ili napravite novi draft SKU.
          </p>
          <AdminActionForm
            action={updateMemberAction}
            refreshOnSuccess
            className="grid gap-2 rounded-xl border border-border/70 bg-background p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
          >
            <input type="hidden" name="productId" value={source.id} />
            <Field label={`Boja 1 · ${source.sku}`}>
              <Input
                name="colorPrimary"
                required
                list={colorListId}
                defaultValue={source.colorPrimary ?? ""}
              />
            </Field>
            <Field label="Boja 2 (opciono)">
              <Input
                name="colorSecondary"
                list={colorListId}
                defaultValue={source.colorSecondary ?? ""}
              />
            </Field>
            <SubmitButton variant="outline" size="sm">
              Sačuvaj boje
            </SubmitButton>
          </AdminActionForm>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-xl border border-border/70 p-4">
          <h3 className="text-sm font-semibold text-ink-900">Poveži postojeći artikal</h3>
          <p className="mt-1 text-xs text-ink-500">
            Pretraga ne menja cenu, stanje, slike, promocije, status ni dobavljača
            izabranog SKU-a.
          </p>
          <label className="relative mt-3 block">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-ink-400" />
            <Input
              value={query}
              onChange={(event) => {
                const nextQuery = event.target.value;
                setQuery(nextQuery);
                if (nextQuery.trim().length < 2) {
                  setCandidates([]);
                  setSelected(null);
                  setSearchError("");
                }
              }}
              placeholder="SKU ili naziv artikla"
              className="pl-8"
              aria-label="Pretraži artikal za povezivanje"
            />
          </label>
          {loading ? <p className="mt-2 text-xs text-ink-500">Pretraga…</p> : null}
          {searchError ? (
            <p className="mt-2 text-xs text-destructive">{searchError}</p>
          ) : null}
          {!loading && query.trim().length >= 2 && !candidates.length && !searchError ? (
            <p className="mt-2 text-xs text-ink-500">Nema rezultata.</p>
          ) : null}
          {candidates.length ? (
            <div className="mt-3 max-h-56 space-y-1 overflow-y-auto pr-1">
              {candidates.map((candidate) => (
                <Button
                  key={candidate.id}
                  type="button"
                  variant={selected?.id === candidate.id ? "secondary" : "outline"}
                  className="h-auto w-full justify-start whitespace-normal px-3 py-2 text-left"
                  disabled={!candidate.canLink}
                  onClick={() => setSelected(candidate)}
                >
                  <span className="relative size-10 shrink-0 overflow-hidden rounded-md bg-[linear-gradient(135deg,#f2f0eb_0_50%,#e5e2db_50%)] ring-1 ring-border">
                    {candidate.imageUrl ? (
                      <Image
                        src={candidate.imageUrl}
                        alt=""
                        fill
                        sizes="40px"
                        className="object-contain p-0.5"
                      />
                    ) : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold">
                      {candidate.sku} · {candidate.name}
                    </span>
                    <span className="block text-[11px] font-normal text-ink-500">
                      {candidate.familyCode
                        ? `Već pripada porodici ${candidate.familyCode}`
                        : [candidate.colorPrimary, candidate.colorSecondary]
                            .filter(Boolean)
                            .join(" / ") || "Boja nije uneta"}
                    </span>
                  </span>
                </Button>
              ))}
            </div>
          ) : null}
          {selected ? (
            <AdminActionForm
              key={selected.id}
              action={linkExistingAction}
              refreshOnSuccess
              className="mt-4 grid gap-3 rounded-lg bg-muted-bg/45 p-3 sm:grid-cols-2"
            >
              <input type="hidden" name="sourceProductId" value={source.id} />
              <input type="hidden" name="targetProductId" value={selected.id} />
              <Field label={`Boja 1 za ${selected.sku}`}>
                <Input
                  name="colorPrimary"
                  required
                  list={colorListId}
                  defaultValue={selected.colorPrimary ?? ""}
                />
              </Field>
              <Field label="Boja 2 (opciono)">
                <Input
                  name="colorSecondary"
                  list={colorListId}
                  defaultValue={selected.colorSecondary ?? ""}
                />
              </Field>
              {selected.readinessReasons.length ? (
                <div className="sm:col-span-2">
                  <p className="text-xs font-medium text-warning">
                    Posle povezivanja boja ostaje skrivena. Trenutno nedostaje:
                  </p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-warning">
                    {selected.readinessReasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <SubmitButton className="sm:col-span-2" disabled={!sourceHasColor}>
                Poveži SKU {selected.sku}
              </SubmitButton>
            </AdminActionForm>
          ) : null}
        </section>

        <section className="rounded-xl border border-border/70 p-4">
          <h3 className="text-sm font-semibold text-ink-900">Napravi novi draft SKU</h3>
          <p className="mt-1 text-xs text-ink-500">
            Novi artikal je neaktivan i skriven dok mu ne dodate sliku, MP cenu i
            ostale podatke potrebne za objavu.
          </p>
          <AdminActionForm
            action={createDraftAction}
            refreshOnSuccess
            className="mt-3 grid gap-3 sm:grid-cols-2"
          >
            <input type="hidden" name="sourceProductId" value={source.id} />
            <Field label="SKU nove boje">
              <Input name="sku" required placeholder="Jedinstvena šifra" />
            </Field>
            <Field label="Boja 1">
              <Input
                name="colorPrimary"
                required
                list={colorListId}
                placeholder="npr. Bela"
              />
            </Field>
            <Field label="Boja 2 (opciono)">
              <Input name="colorSecondary" list={colorListId} />
            </Field>
            <SubmitButton className="self-end" disabled={!sourceHasColor}>
              Kreiraj draft boju
            </SubmitButton>
          </AdminActionForm>
        </section>
      </div>
    </div>
  );
}
