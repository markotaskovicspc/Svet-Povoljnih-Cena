import type { Prisma } from "@prisma/client";

export const RABALUX_OVERRIDE_GROUPS = {
  identity: ["sku", "slug", "name", "barcode", "supplierExternalId"],
  name: ["name"],
  description: ["description", "shortDescription"],
  pricing: ["fullPrice", "salePrice", "discountPct"],
  price: ["fullPrice", "salePrice", "discountPct"],
  stock: ["supplierStock", "supplierNextArrivalAt"],
  flags: ["articleStatus", "isDtz", "isActive", "isNew"],
  dimensions: [
    "widthCm",
    "depthCm",
    "heightCm",
    "weightKg",
    "grossWeightKg",
    "packWidthCm",
    "packDepthCm",
    "packHeightCm",
    "packGrossWeightKg",
  ],
  delivery: ["deliveryDaysMin", "deliveryDaysMax", "allowsAssembly"],
  grouping: ["groupId", "collectionId"],
  specifications: [
    "technicalSpecs",
    "warrantyYears",
    "countryOfOrigin",
    "hsCode",
    "colorPrimary",
    "colorSecondary",
  ],
  categories: ["categories"],
  category: ["categories"],
  media: ["media"],
  attachments: ["attachments"],
  materials: ["materials"],
  pictograms: ["pictograms"],
} as const;

export type RabaluxOverrideGroup = keyof typeof RABALUX_OVERRIDE_GROUPS;

export const RABALUX_OVERRIDE_OPTIONS: ReadonlyArray<{
  value: RabaluxOverrideGroup;
  label: string;
}> = [
  { value: "identity", label: "SKU / barkod / eksterni ID" },
  { value: "name", label: "Naziv" },
  { value: "description", label: "Opisi i PDP tekstovi" },
  { value: "pricing", label: "Cene i akcije" },
  { value: "stock", label: "Dobavljačka zaliha i sledeći prijem" },
  { value: "flags", label: "Dobavljački status i objava" },
  { value: "dimensions", label: "Dimenzije" },
  { value: "delivery", label: "Isporuka i montaža" },
  { value: "grouping", label: "Grupa i kolekcija" },
  { value: "specifications", label: "Specifikacije, boje i carinski podaci" },
  { value: "categories", label: "Kategorije" },
  { value: "media", label: "Fotografije i video" },
  { value: "attachments", label: "Uputstva i energetske oznake" },
  { value: "pictograms", label: "Piktogrami" },
  { value: "materials", label: "Materijali" },
];

const VALID_GROUPS = new Set(RABALUX_OVERRIDE_OPTIONS.map(({ value }) => value));

export function parseOverrideFields(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return new Set<RabaluxOverrideGroup>();
  }
  const fields = (value as Record<string, unknown>).fields;
  if (!Array.isArray(fields)) return new Set<RabaluxOverrideGroup>();
  return new Set(
    fields.filter(
      (field): field is RabaluxOverrideGroup =>
        typeof field === "string" && VALID_GROUPS.has(field as RabaluxOverrideGroup),
    ),
  );
}

export function mergeOverrideFields(
  value: Prisma.JsonValue | null | undefined,
  additions: Iterable<RabaluxOverrideGroup>,
  actorId: string,
) {
  const fields = parseOverrideFields(value);
  for (const addition of additions) fields.add(addition);
  return {
    fields: [...fields].sort(),
    updatedAt: new Date().toISOString(),
    updatedBy: actorId,
  } satisfies Prisma.InputJsonObject;
}

export function applyRabaluxOverrides<T extends Record<string, unknown>>(
  data: T,
  fields: ReadonlySet<RabaluxOverrideGroup>,
) {
  const output: Record<string, unknown> = { ...data };
  for (const field of fields) {
    for (const key of RABALUX_OVERRIDE_GROUPS[field]) delete output[key];
  }
  return output as Partial<T>;
}

export function isRabaluxFieldLocked(
  fields: ReadonlySet<RabaluxOverrideGroup>,
  group: RabaluxOverrideGroup,
) {
  return fields.has(group);
}
