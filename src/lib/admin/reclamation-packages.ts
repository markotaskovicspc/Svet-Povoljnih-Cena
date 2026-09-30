import { z } from "zod";
import { hasKnownMyGlsHardLimitViolation } from "@/lib/courier/packages";

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
