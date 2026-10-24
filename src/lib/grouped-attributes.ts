export type GroupedAttribute = {
  sectionId: string;
  sectionName: string;
  sectionOrder: number;
  optionId: string;
  value: string;
  order: number;
};

export type AttributeFacet = {
  id: string;
  label: string;
  order: number;
  values: Array<{ id: string; label: string; order: number; count: number }>;
};

export function groupedAttributeFacets(
  products: ReadonlyArray<{ groupedAttributes?: GroupedAttribute[] }>,
): AttributeFacet[] {
  const sections = new Map<string, AttributeFacet>();
  for (const product of products) {
    const seen = new Set<string>();
    for (const attribute of product.groupedAttributes ?? []) {
      if (seen.has(attribute.optionId)) continue;
      seen.add(attribute.optionId);
      let section = sections.get(attribute.sectionId);
      if (!section) {
        section = { id: attribute.sectionId, label: attribute.sectionName,
          order: attribute.sectionOrder, values: [] };
        sections.set(section.id, section);
      }
      const value = section.values.find((item) => item.id === attribute.optionId);
      if (value) value.count += 1;
      else section.values.push({ id: attribute.optionId, label: attribute.value,
        order: attribute.order, count: 1 });
    }
  }
  const compare = (a: { order: number; label: string; id: string }, b: { order: number; label: string; id: string }) =>
    a.order - b.order || a.label.localeCompare(b.label, "sr-Latn-RS") || a.id.localeCompare(b.id);
  return [...sections.values()].sort(compare).map((section) => ({
    ...section, values: section.values.sort(compare),
  }));
}

export function matchesGroupedAttributes(
  attributes: GroupedAttribute[] = [],
  selected: Record<string, string[]> = {},
) {
  return Object.entries(selected).every(([sectionId, values]) =>
    !values.length || attributes.some((attribute) =>
      attribute.sectionId === sectionId && values.includes(attribute.optionId)));
}

export type AttributeAssignmentRow = {
  option: {
    id: string; value: string; order: number; active: boolean;
    section: { id: string; name: string; order: number; active: boolean };
  };
};

export function projectGroupedAttributes(rows: AttributeAssignmentRow[] = []): GroupedAttribute[] {
  return rows.filter(({ option }) => option.active && option.section.active)
    .map(({ option }) => ({
      sectionId: option.section.id, sectionName: option.section.name,
      sectionOrder: option.section.order, optionId: option.id,
      value: option.value, order: option.order,
    }));
}
