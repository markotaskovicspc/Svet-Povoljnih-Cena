"use client";

/**
 * Filter sidebar — price/dimensions plus checkbox facets for the complete
 * server-side listing scope, with a local first-page fallback while they load.
 *
 * Used inline on desktop and inside a Sheet on mobile (rendered by ListingShell).
 */
import { useMemo, type ReactNode } from "react";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Product } from "@/types";
import {
  type FilterState,
  type FacetExtents,
  type FacetValues,
  type Availability,
  availabilityLabel,
  computeFacetValues,
  dynamicFacetsForGroups,
  emptyFilterState,
} from "@/lib/listing/filters";

interface FilterSidebarProps {
  source: Product[];
  facetValues?: FacetValues;
  extents: FacetExtents;
  state: FilterState;
  onChange: (next: FilterState) => void;
  className?: string;
}

const AVAILABILITY: Availability[] = ["in-stock", "incoming", "out-of-stock"];

export function FilterSidebar({
  source,
  facetValues,
  extents,
  state,
  onChange,
  className,
}: FilterSidebarProps) {
  const localFacets = useMemo(() => computeFacetValues(source), [source]);
  const facets = facetValues ?? localFacets;
  const groups = facets.groups;
  const dynFacets = useMemo(() => dynamicFacetsForGroups(groups), [groups]);

  const price = state.price ?? extents.price;
  const dimW = state.dimensions?.w ?? extents.width;
  const dimD = state.dimensions?.d ?? extents.depth;
  const dimH = state.dimensions?.h ?? extents.height;

  const reset = () => onChange(emptyFilterState());

  const toggleArrayValue = (
    key: "groups" | "materials" | "colors" | "attributes",
    value: string,
  ) => {
    const arr = state[key];
    onChange({
      ...state,
      [key]: arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value],
    });
  };

  const toggleAvailability = (a: Availability) => {
    const arr = state.availability;
    onChange({
      ...state,
      availability: arr.includes(a) ? arr.filter((v) => v !== a) : [...arr, a],
    });
  };

  const toggleDynamic = (key: string, value: string) => {
    const current = state.dynamic[key] ?? [];
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    onChange({
      ...state,
      dynamic: { ...state.dynamic, [key]: next },
    });
  };

  return (
    <aside
      aria-label="Filteri"
      className={cn(
        "bg-surface ring-border/60 rounded-2xl p-5 ring-1 shadow-soft-1",
        className,
      )}
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg text-ink-900">Filteri</h2>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={reset}
          className="-mr-2 h-8 text-xs text-ink-500 hover:text-ink-900"
        >
          Resetuj
        </Button>
      </div>

      <Accordion
        defaultValue={["cena", "dostupnost"]}
        className="divide-y divide-border/60"
      >
        <AccordionItem value="cena">
          <AccordionTrigger className="text-sm font-medium text-ink-900">
            Cena
          </AccordionTrigger>
          <AccordionContent>
            <div className="px-1 pt-2 pb-1">
              <Slider
                min={extents.price[0]}
                max={extents.price[1]}
                step={500}
                value={[price[0], price[1]]}
                onValueChange={(v) => {
                  if (!Array.isArray(v) || v.length < 2) return;
                  onChange({ ...state, price: [v[0], v[1]] });
                }}
              />
              <div className="mt-3 flex items-center justify-between text-xs text-ink-500">
                <span>{price[0].toLocaleString("sr-Latn-RS")} RSD</span>
                <span>{price[1].toLocaleString("sr-Latn-RS")} RSD</span>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        {facets.groups.length ? (
          <AccordionItem value="grupe">
            <AccordionTrigger className="text-sm font-medium text-ink-900">
              <FacetTitle label="Grupa proizvoda" selected={state.groups.length} />
            </AccordionTrigger>
            <AccordionContent>
              <FacetChecklist
                values={facets.groups}
                selected={state.groups}
                counts={facets.counts.groups}
                labelFor={(group) => facets.groupLabels[group] ?? group}
                onToggle={(group) => toggleArrayValue("groups", group)}
              />
            </AccordionContent>
          </AccordionItem>
        ) : null}

        {facets.colors.length ? (
          <AccordionItem value="boja">
            <AccordionTrigger className="text-sm font-medium text-ink-900">
              <FacetTitle label="Boja" selected={state.colors.length} />
            </AccordionTrigger>
            <AccordionContent>
              <FacetChecklist
                values={facets.colors}
                selected={state.colors}
                counts={facets.counts.colors}
                onToggle={(color) => toggleArrayValue("colors", color)}
                leading={(color) => (
                  <span
                    aria-hidden
                    className="border-border/80 size-4 shrink-0 rounded-full border shadow-[inset_0_0_0_1px_rgb(255_255_255/0.35)]"
                    style={{ background: facets.colorSwatches[color] ?? swatchFor(color) }}
                  />
                )}
              />
            </AccordionContent>
          </AccordionItem>
        ) : null}

        {facets.materials.length ? (
          <AccordionItem value="materijal">
            <AccordionTrigger className="text-sm font-medium text-ink-900">
              <FacetTitle label="Materijal" selected={state.materials.length} />
            </AccordionTrigger>
            <AccordionContent>
              <FacetChecklist
                values={facets.materials}
                selected={state.materials}
                counts={facets.counts.materials}
                onToggle={(material) => toggleArrayValue("materials", material)}
              />
            </AccordionContent>
          </AccordionItem>
        ) : null}

        {facets.attributes.length ? (
          <AccordionItem value="atributi">
            <AccordionTrigger className="text-sm font-medium text-ink-900">
              <FacetTitle label="Atributi" selected={state.attributes.length} />
            </AccordionTrigger>
            <AccordionContent>
              <FacetChecklist
                values={facets.attributes}
                selected={state.attributes}
                counts={facets.counts.attributes}
                onToggle={(attribute) => toggleArrayValue("attributes", attribute)}
              />
            </AccordionContent>
          </AccordionItem>
        ) : null}

        <AccordionItem value="dimenzije">
          <AccordionTrigger className="text-sm font-medium text-ink-900">
            Dimenzije (cm)
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pt-2">
              <DimensionRow
                axis="Š"
                ext={extents.width}
                value={dimW}
                onChange={(v) =>
                  onChange({
                    ...state,
                    dimensions: { ...(state.dimensions ?? {}), w: v },
                  })
                }
              />
              <DimensionRow
                axis="D"
                ext={extents.depth}
                value={dimD}
                onChange={(v) =>
                  onChange({
                    ...state,
                    dimensions: { ...(state.dimensions ?? {}), d: v },
                  })
                }
              />
              <DimensionRow
                axis="V"
                ext={extents.height}
                value={dimH}
                onChange={(v) =>
                  onChange({
                    ...state,
                    dimensions: { ...(state.dimensions ?? {}), h: v },
                  })
                }
              />
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="dostupnost">
          <AccordionTrigger className="text-sm font-medium text-ink-900">
            Dostupnost
          </AccordionTrigger>
          <AccordionContent>
            <ul className="flex flex-col gap-2 pt-1">
              {AVAILABILITY.map((a) => (
                <li key={a}>
                  <Label className="flex cursor-pointer items-center gap-2 text-sm text-ink-700">
                    <Checkbox
                      aria-label={`${availabilityLabel(a)} (${facets.counts.availability[a]})`}
                      checked={state.availability.includes(a)}
                      onCheckedChange={() => toggleAvailability(a)}
                    />
                    <span className="min-w-0 flex-1">{availabilityLabel(a)}</span>
                    <span className="text-xs tabular-nums text-ink-300">
                      {facets.counts.availability[a]}
                    </span>
                  </Label>
                </li>
              ))}
            </ul>
          </AccordionContent>
        </AccordionItem>

        {dynFacets.map((f) => {
          const values = facets.dynamic[f.key] ?? [];
          if (!values.length) return null;
          return (
            <AccordionItem key={f.key} value={f.key}>
              <AccordionTrigger className="text-sm font-medium text-ink-900">
                {f.label}
              </AccordionTrigger>
              <AccordionContent>
                <ul className="flex flex-col gap-2 pt-1">
                  {values.map((v) => (
                    <li key={v}>
                      <Label className="flex cursor-pointer items-center gap-2 text-sm text-ink-700">
                        <Checkbox
                          checked={(state.dynamic[f.key] ?? []).includes(v)}
                          onCheckedChange={() => toggleDynamic(f.key, v)}
                        />
                        {v}
                      </Label>
                    </li>
                  ))}
                </ul>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    </aside>
  );
}

function FacetTitle({ label, selected }: { label: string; selected: number }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span>{label}</span>
      {selected ? (
        <span className="bg-ink-900 text-canvas inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] leading-none">
          {selected}
        </span>
      ) : null}
    </span>
  );
}

function FacetChecklist({
  values,
  selected,
  counts,
  onToggle,
  labelFor = (value) => value,
  leading,
}: {
  values: string[];
  selected: string[];
  counts: Record<string, number>;
  onToggle: (value: string) => void;
  labelFor?: (value: string) => string;
  leading?: (value: string) => ReactNode;
}) {
  return (
    <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto pt-1 pr-1">
      {values.map((value) => {
        const label = labelFor(value);
        const count = counts[value] ?? 0;
        return (
          <li key={value}>
            <Label className="hover:bg-muted-bg/60 flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1.5 text-sm text-ink-700 transition">
              <Checkbox
                aria-label={`${label} (${count})`}
                checked={selected.includes(value)}
                onCheckedChange={() => onToggle(value)}
              />
              {leading?.(value)}
              <span className="min-w-0 flex-1 leading-snug">{label}</span>
              <span className="text-xs tabular-nums text-ink-300">
                {count}
              </span>
            </Label>
          </li>
        );
      })}
    </ul>
  );
}

function DimensionRow({
  axis,
  ext,
  value,
  onChange,
}: {
  axis: string;
  ext: [number, number];
  value: [number, number];
  onChange: (v: [number, number]) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs text-ink-500">
        <span className="font-mono">{axis}</span>
        <span>
          {value[0]}–{value[1]} cm
        </span>
      </div>
      <Slider
        min={ext[0]}
        max={ext[1]}
        step={1}
        value={[value[0], value[1]]}
        onValueChange={(v) => {
          if (!Array.isArray(v) || v.length < 2) return;
          onChange([v[0], v[1]]);
        }}
      />
    </div>
  );
}

/** Fallback swatches for products that do not yet have a curated colour hex. */
function swatchFor(label: string): string {
  const map: Record<string, string> = {
    crna: "#171717",
    bela: "#FFFFFF",
    siva: "#8A8A8A",
    srebrna: "#C0C0C0",
    silver: "#C0C0C0",
    crvena: "#C83A36",
    plava: "#356AA0",
    zelena: "#5F7F52",
    mint: "#A9D6C2",
    žuta: "#E6C743",
    narandžasta: "#D97932",
    roze: "#D98FA7",
    ljubičasta: "#76548F",
    bež: "#D8C7AA",
    braon: "#72513D",
    zlatna: "#C5A24A",
    hrast: "#C49A6C",
    orah: "#5A3A1F",
    jasen: "#E0CDA9",
    bor: "#D6B98E",
    providna: "linear-gradient(135deg, #ffffff 0 44%, #cbd5e1 45% 55%, #ffffff 56% 100%)",
    staklena: "linear-gradient(135deg, #eef7fa, #c9e5ec)",
  };
  const lower = label.toLowerCase();
  for (const k of Object.keys(map)) {
    if (lower.includes(k)) return map[k];
  }
  return "var(--muted-bg)";
}
