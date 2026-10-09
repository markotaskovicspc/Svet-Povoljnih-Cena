import { z } from "zod";
import { courierPackageCount, derivePhysicalPackages, hasKnownMyGlsHardLimitViolation, MAX_COURIER_PACKAGES, type PackageSourceItem } from "@/lib/courier/packages";

const measurement = (label: string, max: number, decimals = 2) => z.number()
  .min(10 ** -decimals, `${label} mora biti najmanje ${10 ** -decimals}.`)
  .max(max, `${label} je prevelika.`)
  .transform((value) => Math.round(value * 10 ** decimals) / 10 ** decimals);
const packagesSchema = z.array(z.object({
  weightKg: measurement("Težina", 1000, 3),
  widthCm: measurement("Širina", 500),
  depthCm: measurement("Dužina", 500),
  heightCm: measurement("Visina", 500),
})).min(1, "Unesite mere najmanje jednog paketa.").max(99, "Dozvoljeno je najviše 99 paketa.");

export type ReclamationPackage = z.infer<typeof packagesSchema>[number];
export type ReclamationPackageDraft = { [Key in keyof ReclamationPackage]: number | null };

/** Catalogue suggestions are editable and never imply warehouse readiness. */
export function reclamationCataloguePackages(input: {
  resolution: string | null;
  quantity: number;
  replacementQty: number | null;
  product: PackageSourceItem["product"];
}): ReclamationPackageDraft[] {
  const qty = input.replacementQty ?? input.quantity;
  if (input.resolution !== "ZAMENA_ARTIKLA" || !input.product ||
    !Number.isInteger(qty) || qty < 1 ||
    courierPackageCount(qty, input.product.courierUnitsPerBox) > MAX_COURIER_PACKAGES) return [];

  return derivePhysicalPackages([{ id: "replacement", name: "Zamena", qty, product: input.product }],
    { consolidatePompea: false }).map(({ weightKg, widthCm, depthCm, heightCm }) => ({
    weightKg, widthCm, depthCm, heightCm,
  }));
}

export function parseReclamationPackages(value: unknown): ReclamationPackage[] {
  const result = packagesSchema.safeParse(value);
  if (!result.success) throw new Error(`Mere zamene: ${result.error.issues[0]?.message ?? "unesite težinu i sve dimenzije."}`);
  if (result.data.some((pkg, i) => hasKnownMyGlsHardLimitViolation({ ...pkg, packageNo: i + 1 }))) {
    throw new Error("Paket zamene prelazi 40 kg ili 200 cm. Podelite robu u manje pakete pre potvrde spremnosti.");
  }
  return result.data;
}

export function readReclamationPackages(value: unknown): ReclamationPackage[] {
  try { return parseReclamationPackages(value); } catch { return []; }
}
