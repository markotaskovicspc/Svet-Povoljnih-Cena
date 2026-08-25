export const MAX_COURIER_PACKAGES = 99;
export const MAX_MYGLS_PACKAGE_WEIGHT_KG = 40;
export const MAX_MYGLS_PACKAGE_SIDE_CM = 200;
export const MAX_MYGLS_PACKAGE_GIRTH_CM = 300;

export type PhysicalPackage = {
  packageNo: number;
  orderItemId?: string | null;
  content?: string | null;
  weightKg: number | null;
  widthCm: number | null;
  depthCm: number | null;
  heightCm: number | null;
};

export type CompletePhysicalPackage = {
  packageNo: number;
  orderItemId?: string | null;
  content?: string | null;
  weightKg: number;
  widthCm: number;
  depthCm: number;
  heightCm: number;
};

export type PackageSourceItem = {
  id: string;
  name: string;
  qty: number;
  product?: {
    packQty?: number | null;
    packWidthCm?: unknown;
    packDepthCm?: unknown;
    packHeightCm?: unknown;
    packGrossWeightKg?: unknown;
    unitPackWidthCm?: unknown;
    unitPackDepthCm?: unknown;
    unitPackHeightCm?: unknown;
    widthCm?: unknown;
    depthCm?: unknown;
    heightCm?: unknown;
    grossWeightKg?: unknown;
    weightKg?: unknown;
  } | null;
};

/**
 * Returns true only when the known measurements already exceed a MyGLS
 * provider limit. Incomplete measurements are left for explicit operator
 * entry and are not treated as a limit violation here.
 */
export function hasKnownMyGlsLimitViolation(pkg: PhysicalPackage) {
  const weightKg = positiveNumber(pkg.weightKg);
  const dimensions = [
    positiveNumber(pkg.widthCm),
    positiveNumber(pkg.depthCm),
    positiveNumber(pkg.heightCm),
  ];
  if (weightKg != null && weightKg > MAX_MYGLS_PACKAGE_WEIGHT_KG) return true;
  if (dimensions.some((value) => value == null)) return false;

  const complete = dimensions as number[];
  const longest = Math.max(...complete);
  const girth =
    longest + 2 * (complete.reduce((sum, value) => sum + value, 0) - longest);
  return longest > MAX_MYGLS_PACKAGE_SIDE_CM || girth > MAX_MYGLS_PACKAGE_GIRTH_CM;
}

/**
 * Expands order lines into physical packages. Catalogue pack measurements are
 * copied when present; missing values intentionally remain null so an operator
 * must enter real measurements before a provider request can be sent.
 */
export function derivePhysicalPackages(
  items: readonly PackageSourceItem[],
): PhysicalPackage[] {
  const packages: PhysicalPackage[] = [];

  for (const item of items) {
    const qty = positiveInteger(item.qty) ?? 1;
    const packQty = positiveInteger(item.product?.packQty) ?? 1;
    const count = Math.max(1, Math.ceil(qty / packQty));
    for (let index = 0; index < count; index += 1) {
      packages.push({
        packageNo: packages.length + 1,
        orderItemId: item.id,
        content: item.name,
        weightKg:
          positiveNumber(item.product?.packGrossWeightKg) ??
          positiveNumber(item.product?.grossWeightKg) ??
          positiveNumber(item.product?.weightKg),
        widthCm:
          positiveNumber(item.product?.packWidthCm) ??
          positiveNumber(item.product?.unitPackWidthCm) ??
          positiveNumber(item.product?.widthCm),
        depthCm:
          positiveNumber(item.product?.packDepthCm) ??
          positiveNumber(item.product?.unitPackDepthCm) ??
          positiveNumber(item.product?.depthCm),
        heightCm:
          positiveNumber(item.product?.packHeightCm) ??
          positiveNumber(item.product?.unitPackHeightCm) ??
          positiveNumber(item.product?.heightCm),
      });
    }
  }

  if (packages.length > MAX_COURIER_PACKAGES) {
    throw new Error(
      `Kurirski nalog može imati najviše ${MAX_COURIER_PACKAGES} paketa; izvedeno je ${packages.length}.`,
    );
  }
  return packages;
}

/** Validates provider-safe package measurements and returns normalized values. */
export function requireCompleteMyGlsPackages(
  packages: readonly PhysicalPackage[],
): CompletePhysicalPackage[] {
  if (!packages.length) {
    throw new Error("MyGLS nalog mora sadržati najmanje jedan fizički paket.");
  }
  if (packages.length > MAX_COURIER_PACKAGES) {
    throw new Error(`MyGLS nalog može imati najviše ${MAX_COURIER_PACKAGES} paketa.`);
  }

  return packages.map((pkg, index) => {
    const packageNo = positiveInteger(pkg.packageNo) ?? index + 1;
    const weightKg = positiveNumber(pkg.weightKg);
    const widthCm = positiveNumber(pkg.widthCm);
    const depthCm = positiveNumber(pkg.depthCm);
    const heightCm = positiveNumber(pkg.heightCm);
    const missing = [
      ["težina", weightKg],
      ["širina", widthCm],
      ["dubina/dužina", depthCm],
      ["visina", heightCm],
    ]
      .filter(([, value]) => value == null)
      .map(([label]) => label);
    if (missing.length) {
      throw new Error(
        `Paket ${packageNo} nema kompletne stvarne mere: ${missing.join(", ")}.`,
      );
    }
    const completeWeightKg = weightKg as number;
    const completeWidthCm = widthCm as number;
    const completeDepthCm = depthCm as number;
    const completeHeightCm = heightCm as number;
    if (completeWeightKg > MAX_MYGLS_PACKAGE_WEIGHT_KG) {
      throw new Error(
        `Paket ${packageNo} ima ${completeWeightKg} kg; MyGLS granica je ${MAX_MYGLS_PACKAGE_WEIGHT_KG} kg po paketu.`,
      );
    }
    const dimensions = [completeWidthCm, completeDepthCm, completeHeightCm];
    const longest = Math.max(...dimensions);
    if (longest > MAX_MYGLS_PACKAGE_SIDE_CM) {
      throw new Error(
        `Paket ${packageNo} ima stranicu ${longest} cm; dozvoljeno je najviše ${MAX_MYGLS_PACKAGE_SIDE_CM} cm.`,
      );
    }
    const girth = longest + 2 * (dimensions.reduce((sum, value) => sum + value, 0) - longest);
    if (girth > MAX_MYGLS_PACKAGE_GIRTH_CM) {
      throw new Error(
        `Paket ${packageNo} ima obim sa najdužom stranicom ${girth} cm; dozvoljeno je najviše ${MAX_MYGLS_PACKAGE_GIRTH_CM} cm.`,
      );
    }
    return {
      packageNo,
      orderItemId: pkg.orderItemId,
      content: pkg.content,
      weightKg: completeWeightKg,
      widthCm: completeWidthCm,
      depthCm: completeDepthCm,
      heightCm: completeHeightCm,
    };
  });
}

/** Validates that actual measurements exist, without applying provider caps. */
export function requireCompletePhysicalPackages(
  packages: readonly PhysicalPackage[],
): CompletePhysicalPackage[] {
  if (!packages.length) {
    throw new Error("Kurirski nalog mora sadržati najmanje jedan fizički paket.");
  }
  if (packages.length > MAX_COURIER_PACKAGES) {
    throw new Error(`Kurirski nalog može imati najviše ${MAX_COURIER_PACKAGES} paketa.`);
  }
  return packages.map((pkg, index) => {
    const packageNo = positiveInteger(pkg.packageNo) ?? index + 1;
    const values = {
      weightKg: positiveNumber(pkg.weightKg),
      widthCm: positiveNumber(pkg.widthCm),
      depthCm: positiveNumber(pkg.depthCm),
      heightCm: positiveNumber(pkg.heightCm),
    };
    const missing = [
      ["težina", values.weightKg],
      ["širina", values.widthCm],
      ["dubina/dužina", values.depthCm],
      ["visina", values.heightCm],
    ]
      .filter(([, value]) => value == null)
      .map(([label]) => label);
    if (missing.length) {
      throw new Error(
        `Paket ${packageNo} nema kompletne stvarne mere: ${missing.join(", ")}.`,
      );
    }
    return {
      packageNo,
      orderItemId: pkg.orderItemId,
      content: pkg.content,
      weightKg: values.weightKg!,
      widthCm: values.widthCm!,
      depthCm: values.depthCm!,
      heightCm: values.heightCm!,
    };
  });
}

function positiveNumber(value: unknown) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function positiveInteger(value: unknown) {
  const number = positiveNumber(value);
  return number != null && Number.isInteger(number) ? number : null;
}
