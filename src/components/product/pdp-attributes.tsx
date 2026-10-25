import {
  groupedAttributeFacets,
  type GroupedAttribute,
} from "@/lib/grouped-attributes";

export function PdpAttributes({
  attributes,
}: {
  attributes?: GroupedAttribute[];
}) {
  const sections = groupedAttributeFacets([{ groupedAttributes: attributes }]);
  if (!sections.length) return null;

  return (
    <dl aria-label="Atributi proizvoda" className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {sections.map((section) => (
        <div
          key={section.id}
          className="flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-1"
        >
          <dt className="max-w-full text-xs font-medium break-words text-ink-500">
            {section.label}:
          </dt>
          <dd className="flex min-w-0 flex-wrap gap-1.5">
            {section.values.map((value) => (
              <span
                key={value.id}
                className="max-w-full rounded-full bg-white px-2 py-1 text-xs font-semibold break-words text-ink-800 ring-1 ring-border/60"
              >
                {value.label}
              </span>
            ))}
          </dd>
        </div>
      ))}
    </dl>
  );
}
