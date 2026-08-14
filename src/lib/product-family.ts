const FAMILY_CODE_MAX = 64;
const FAMILY_LABEL_MAX = 120;

export function normalizeProductFamilyCode(value: string) {
  const normalized = value
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, "-")
    .replace(/[^A-Z0-9._-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, FAMILY_CODE_MAX);
  if (!normalized) {
    throw new Error("Šifra porodice mora sadržati slovo ili broj.");
  }
  return normalized;
}

export function normalizeProductFamilyLabel(value: string) {
  const label = value.replace(/\s+/g, " ").trim().slice(0, FAMILY_LABEL_MAX);
  if (!label) throw new Error("Naziv boje je obavezan za član porodice.");
  return label;
}

export function productFamilyLabelKey(value: string) {
  return normalizeProductFamilyLabel(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("sr-Latn-RS");
}

export function normalizeProductFamilyHex(value: string | null | undefined) {
  const hex = value?.trim();
  if (!hex) return null;
  const normalized = hex.startsWith("#") ? hex : `#${hex}`;
  if (!/^#[0-9a-f]{6}$/i.test(normalized)) {
    throw new Error("HEX boja mora biti u formatu #RRGGBB.");
  }
  return normalized.toUpperCase();
}

export function defaultProductFamilyLabel(input: {
  colorPrimary?: string | null;
  colorSecondary?: string | null;
}) {
  const values = [input.colorPrimary, input.colorSecondary]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  const seen = new Set<string>();
  return values
    .map(formatProductFamilyColor)
    .filter((value) => {
      const key = value
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("sr-Latn-RS");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(" / ");
}

function formatProductFamilyColor(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim().toLocaleLowerCase("sr-Latn-RS");
  if (!normalized) return "";
  return `${normalized[0]!.toLocaleUpperCase("sr-Latn-RS")}${normalized.slice(1)}`;
}

export function productFamilyReadinessReasons(input: {
  colorPrimary?: string | null;
  colorSecondary?: string | null;
  hasReadyImage: boolean;
  publicationBlockers?: readonly string[];
}) {
  const reasons = [...(input.publicationBlockers ?? [])];
  if (!defaultProductFamilyLabel(input)) {
    reasons.unshift("Nije uneta Boja 1");
  }
  if (!input.hasReadyImage) {
    reasons.push("Nema spremnu glavnu fotografiju");
  }
  return Array.from(new Set(reasons));
}
