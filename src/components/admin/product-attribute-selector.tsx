import Link from "next/link";

export function ProductAttributeSelector({ sections, selected }: {
  sections: Array<{ id: string; name: string; active: boolean;
    options: Array<{ id: string; value: string; active: boolean }> }>;
  selected: string[];
}) {
  const chosen = new Set(selected);
  return <fieldset className="space-y-3 rounded-xl border border-border/60 p-4">
    <legend className="px-2 text-sm font-medium">Atributi za filtere</legend>
    <input type="hidden" name="attributeSelectionPresent" value="1" />
    <p className="text-xs text-ink-500">Izaberite vrednosti koje važe za ovaj artikal. <Link className="underline" href="/admin/atributi">Uredi celine i vrednosti</Link></p>
    {sections.filter((section) => section.active || section.options.some((option) => chosen.has(option.id)))
      .map((section) => <fieldset key={section.id} className="rounded-lg border p-3">
        <legend className="px-1 text-sm">{section.name}{!section.active ? " (neaktivna)" : ""}</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {section.options.filter((option) => (option.active && section.active) || chosen.has(option.id))
            .map((option) => <label key={option.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="attributeOptionIds" value={option.id} defaultChecked={chosen.has(option.id)} />
              {option.value}{!option.active ? " (neaktivna)" : ""}
            </label>)}
        </div>
      </fieldset>)}
    {!sections.length ? <p className="text-sm text-ink-500">Prvo dodajte celine u tabu Atributi.</p> : null}
  </fieldset>;
}
