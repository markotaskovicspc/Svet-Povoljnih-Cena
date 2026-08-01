import {
  richTextPlainText,
  sanitizeRichText,
} from "@/lib/rich-text";

type ExistingProductDescriptions = {
  description?: string | null;
  shortDescription?: string | null;
};

export function hasMeaningfulProductDescription(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    richTextPlainText(value).replace(/\u00a0/g, " ").trim().length > 0
  );
}

export function normalizeFullProductDescription(value: string) {
  return sanitizeRichText(value);
}

export function normalizeShortProductDescription(
  value: string | null | undefined,
) {
  const normalized = value?.replace(/\u00a0/g, " ").trim();
  return normalized || null;
}

/**
 * Spreadsheet blanks mean "leave the existing admin value alone". Clearing
 * either description remains available from the product detail form, where
 * the action is explicit and audited.
 */
export function resolveImportedFullDescription(args: {
  columnPresent: boolean;
  incoming: string | null | undefined;
  current: string | null | undefined;
}) {
  const current = args.current ?? "";
  if (!args.columnPresent) return current;
  const incoming = normalizeFullProductDescription(args.incoming ?? "");
  return hasMeaningfulProductDescription(incoming) ? incoming : current;
}

export function resolveImportedShortDescription(args: {
  columnPresent: boolean;
  incoming: string | null | undefined;
  current: string | null | undefined;
}) {
  const current = normalizeShortProductDescription(args.current);
  if (!args.columnPresent) return current;
  return normalizeShortProductDescription(args.incoming) ?? current;
}

/**
 * Supplier feeds are allowed to refresh a meaningful description, but an
 * empty/missing supplier value must never erase content already stored in the
 * canonical product record. Explicit sync overrides are applied separately.
 */
export function preserveExistingProductDescriptions<
  T extends Record<string, unknown>,
>(data: T, existing: ExistingProductDescriptions): T {
  const output = { ...data };
  for (const key of ["description", "shortDescription"] as const) {
    if (!Object.prototype.hasOwnProperty.call(output, key)) continue;
    if (
      hasMeaningfulProductDescription(existing[key]) &&
      !hasMeaningfulProductDescription(output[key])
    ) {
      delete output[key];
    }
  }
  return output;
}
