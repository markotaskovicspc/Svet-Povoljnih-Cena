import { SYSTEM_CONTENT_SLUGS } from "./system-pages";

export const CONTENT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const APP_RESERVED_SLUGS = [
  "admin",
  "api",
  "nalog",
  "checkout",
  "k",
  "kolekcija",
  "korpa",
  "p",
  "svet-akcija",
  "akcija",
  "heroji-meseca",
  "nedeljna-akcija",
  "niske-cene-pod-zastitom",
  "novo",
  "ogranicena-ponuda",
  "outlet",
  "pretraga",
  "specijalne-ponude",
  "sve-do-999",
  "kontakt",
  "servis",
  "komentari",
  "podesavanja-kolacica",
] as const;

export const RESERVED_CONTENT_SLUGS = new Set<string>([
  ...APP_RESERVED_SLUGS,
  ...SYSTEM_CONTENT_SLUGS,
]);

export const CONTENT_FOOTER_COLUMNS = [
  { value: "COMPANY", label: "Svet Povoljnih Cena" },
  { value: "TERMS", label: "Uslovi" },
] as const;

export type ContentFooterColumnValue =
  (typeof CONTENT_FOOTER_COLUMNS)[number]["value"];

export function normalizeContentSlug(value: string) {
  return value.trim().toLowerCase();
}

export function contentPreviewPath(value: string) {
  return `/${normalizeContentSlug(value) || "slug"}`;
}

export function validateContentSlug(
  value: string,
  options: { allowSystemSlug?: boolean } = {},
) {
  const slug = normalizeContentSlug(value);
  if (slug.length < 2 || slug.length > 120) {
    return "Slug mora imati između 2 i 120 znakova.";
  }
  if (!CONTENT_SLUG_PATTERN.test(slug)) {
    return "Slug sme da sadrži samo mala slova, brojeve i crtice.";
  }
  if (!options.allowSystemSlug && RESERVED_CONTENT_SLUGS.has(slug)) {
    return "Ovaj slug je rezervisan za postojeću funkciju sajta.";
  }
  return null;
}

export function footerColumnLabel(value: string | null | undefined) {
  return CONTENT_FOOTER_COLUMNS.find((column) => column.value === value)?.label;
}
