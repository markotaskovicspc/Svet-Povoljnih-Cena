import Link from "next/link";

export function ProductAttributeSelector({ sections, selected }: {
  sections: Array<{ id: string; name: string; active: boolean;
    options: Array<{ id: string; value: string; active: boolean }> }>;
  selected: string[];
}) {
  const chosen = new Set(selected);
  return <fieldset className="min-w-0 space-y-2 rounded-xl border border-border/60 p-3">
    <legend className="px-2 text-sm font-medium">Atributi za filtere</legend>
    <input type="hidden" name="attributeSelectionPresent" value="1" />
    <p className="text-xs text-ink-500">Izaberite vrednosti koje važe za ovaj artikal. <Link className="underline" href="/admin/atributi">Uredi celine i vrednosti</Link></p>
    <div className="flex flex-wrap items-start gap-2">
    {sections.filter((section) => section.active || section.options.some((option) => chosen.has(option.id)))
      .map((section) => <fieldset key={section.id} className="min-w-0 max-w-full rounded-lg border px-2.5 pb-1.5 pt-0.5">
        <legend className="max-w-full px-1 text-xs font-medium [overflow-wrap:anywhere]">{section.name}{!section.active ? " (neaktivna)" : ""}</legend>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          {section.options.filter((option) => (option.active && section.active) || chosen.has(option.id))
            .map((option) => <label key={option.id} className="flex min-h-6 min-w-0 max-w-full cursor-pointer items-center gap-1.5 text-sm">
              <input className="size-3.5 shrink-0" type="checkbox" name="attributeOptionIds" value={option.id} defaultChecked={chosen.has(option.id)} />
              <span className="min-w-0 [overflow-wrap:anywhere]">{option.value}{!option.active ? " (neaktivna)" : ""}</span>
            </label>)}
        </div>
      </fieldset>)}
    </div>
    {!sections.length ? <p className="text-sm text-ink-500">Prvo dodajte celine u tabu Atributi.</p> : null}
  </fieldset>;
}
