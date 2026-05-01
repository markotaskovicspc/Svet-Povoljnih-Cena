"use client";

/**
 * Filter sidebar — fixed facets (cena/boja/materijal/dimenzije/dostupnost)
 * + per-group dynamic facets discovered from the source list.
 *
 * Used inline on desktop and inside a Sheet on mobile (rendered by ListingShell).
 */
import { useMemo } from "react";
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
  extents: FacetExtents;
  state: FilterState;
  onChange: (next: FilterState) => void;
  className?: string;
}

const AVAILABILITY: Availability[] = ["in-stock", "incoming", "out-of-stock"];

export function FilterSidebar({
  source,
  extents,
  state,
  onChange,
  className,
}: FilterSidebarProps) {
  const facets: FacetValues = useMemo(() => computeFacetValues(source), [source]);
  const groups = useMemo(
    () => Array.from(new Set(source.map((p) => p.group))),
    [source],
  );
  const dynFacets = useMemo(() => dynamicFacetsForGroups(groups), [groups]);

  const price = state.price ?? extents.price;
  const dimW = state.dimensions?.w ?? extents.width;
  const dimD = state.dimensions?.d ?? extents.depth;
  const dimH = state.dimensions?.h ?? extents.height;

  const reset = () => onChange(emptyFilterState());

  const toggleArrayValue = (key: "materials" | "colors", value: string) => {
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

        {facets.colors.length ? (
          <AccordionItem value="boja">
            <AccordionTrigger className="text-sm font-medium text-ink-900">
              Boja
            </AccordionTrigger>
            <AccordionContent>
              <div className="flex flex-wrap gap-2 pt-1">
                {facets.colors.map((c) => {
                  const active = state.colors.includes(c);
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => toggleArrayValue("colors", c)}
                      aria-pressed={active}
                      className={cn(
                        "ring-border/60 hover:ring-walnut/40 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs ring-1 transition",
                        active
                          ? "bg-ink-900 text-canvas ring-ink-900"
                          : "bg-surface text-ink-700",
                      )}
                    >
                      <span
                        aria-hidden
                        className="border-border/80 size-3 rounded-full border"
                        style={{ backgroundColor: swatchFor(c) }}
                      />
                      {c}
                    </button>
                  );
                })}
              </div>
            </AccordionContent>
          </AccordionItem>
        ) : null}

        {facets.materials.length ? (
          <AccordionItem value="materijal">
            <AccordionTrigger className="text-sm font-medium text-ink-900">
              Materijal
            </AccordionTrigger>
            <AccordionContent>
              <ul className="flex flex-col gap-2 pt-1">
                {facets.materials.map((m) => (
                  <li key={m}>
                    <Label className="flex cursor-pointer items-center gap-2 text-sm text-ink-700">
                      <Checkbox
                        checked={state.materials.includes(m)}
                        onCheckedChange={() => toggleArrayValue("materials", m)}
                      />
                      {m}
                    </Label>
                  </li>
                ))}
              </ul>
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
                      checked={state.availability.includes(a)}
                      onCheckedChange={() => toggleAvailability(a)}
                    />
                    {availabilityLabel(a)}
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

/** Quick deterministic swatch hint for color chips. Phase 4 will source actual hex from the feed. */
function swatchFor(label: string): string {
  const map: Record<string, string> = {
    hrast: "#C49A6C",
    orah: "#5A3A1F",
    jasen: "#E0CDA9",
    bor: "#D6B98E",
  };
  const lower = label.toLowerCase();
  for (const k of Object.keys(map)) {
    if (lower.includes(k)) return map[k];
  }
  return "var(--muted-bg)";
}
