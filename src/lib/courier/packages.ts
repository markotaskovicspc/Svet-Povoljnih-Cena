import { packageVolumetricDimension } from "@/lib/delivery-tariff";

export const MAX_COURIER_PACKAGES = 99;
export const MAX_X_EXPRESS_PACKAGE_WEIGHT_KG = 30;
export const MAX_X_EXPRESS_PACKAGE_SIDE_CM = 60;
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
 * Courier labels follow the merchant's operational rule: every sold unit is
 * handed to the courier as its own package. Catalogue `packQty` describes
 * inbound/warehouse transport packaging and must never merge customer units.
 */
export function courierPackageCount(quantity: unknown) {
  return positiveInteger(quantity) ?? 1;
}

/** Returns the weight of one customer-facing package. */
export function courierUnitWeightKg(
  product: PackageSourceItem["product"],
) {
  const individualWeight =
    positiveNumber(product?.grossWeightKg) ??
    positiveNumber(product?.weightKg);
  if (individualWeight != null) return individualWeight;

  const transportWeight = positiveNumber(product?.packGrossWeightKg);
  if (transportWeight == null) return null;
  const unitsPerTransportPackage = positiveInteger(product?.packQty) ?? 1;
  return transportWeight / unitsPerTransportPackage;
}

/**
 * Weight above 40 kg and a side above 200 cm are hard MyGLS limits. The
 * 300 cm volumetric boundary is handled separately because the published
 * Serbian terms and the merchant tariff allow larger parcels with a surcharge.
 */
export function hasKnownMyGlsHardLimitViolation(pkg: PhysicalPackage) {
  const weightKg = positiveNumber(pkg.weightKg);
  const dimensions = [
    positiveNumber(pkg.widthCm),
    positiveNumber(pkg.depthCm),
    positiveNumber(pkg.heightCm),
  ];
  if (weightKg != null && weightKg > MAX_MYGLS_PACKAGE_WEIGHT_KG) return true;
  if (dimensions.some((value) => value == null)) return false;

  const complete = dimensions as number[];
  return Math.max(...complete) > MAX_MYGLS_PACKAGE_SIDE_CM;
}

export function hasKnownXExpressHardLimitViolation(pkg: PhysicalPackage) {
  const weightKg = positiveNumber(pkg.weightKg);
  const dimensions = [
    positiveNumber(pkg.widthCm),
    positiveNumber(pkg.depthCm),
    positiveNumber(pkg.heightCm),
  ];
  if (weightKg != null && weightKg > MAX_X_EXPRESS_PACKAGE_WEIGHT_KG) {
    return true;
  }
  if (dimensions.some((value) => value == null)) return false;
  return Math.max(...(dimensions as number[])) > MAX_X_EXPRESS_PACKAGE_SIDE_CM;
}

/** Returns true when complete dimensions fall into the surcharge category. */
export function hasKnownMyGlsOversizeSurcharge(pkg: PhysicalPackage) {
  const dimensions = [
    positiveNumber(pkg.widthCm),
    positiveNumber(pkg.depthCm),
    positiveNumber(pkg.heightCm),
  ];
  if (dimensions.some((value) => value == null)) return false;
  return (
    packageVolumetricDimension(dimensions as number[]) >
    MAX_MYGLS_PACKAGE_GIRTH_CM
  );
}

/**
 * Expands order lines into one physical package per sold unit. Individual
 * article packaging is the only catalogue source for courier dimensions.
 * Missing values intentionally remain null so an operator must enter real
 * measurements before a provider request can be sent.
 */
export function derivePhysicalPackages(
  items: readonly PackageSourceItem[],
): PhysicalPackage[] {
  const packages: PhysicalPackage[] = [];

  for (const item of items) {
    const count = courierPackageCount(item.qty);
    for (let index = 0; index < count; index += 1) {
      packages.push({
        packageNo: packages.length + 1,
        orderItemId: item.id,
        content: item.name,
        weightKg: courierUnitWeightKg(item.product),
        widthCm: positiveNumber(item.product?.unitPackWidthCm),
        depthCm: positiveNumber(item.product?.unitPackDepthCm),
        heightCm: positiveNumber(item.product?.unitPackHeightCm),
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

/** Validates provider-safe hard limits and returns normalized values. */
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

export function requireCompleteXExpressPackages(
  packages: readonly PhysicalPackage[],
) {
  const complete = requireCompletePhysicalPackages(packages);
  for (const pkg of complete) {
    if (pkg.weightKg > MAX_X_EXPRESS_PACKAGE_WEIGHT_KG) {
      throw new Error(
        `Paket ${pkg.packageNo} ima ${pkg.weightKg} kg; X Express granica je ${MAX_X_EXPRESS_PACKAGE_WEIGHT_KG} kg po paketu.`,
      );
    }
    const longest = Math.max(pkg.widthCm, pkg.depthCm, pkg.heightCm);
    if (longest > MAX_X_EXPRESS_PACKAGE_SIDE_CM) {
      throw new Error(
        `Paket ${pkg.packageNo} ima stranicu ${longest} cm; X Express dozvoljava najviše ${MAX_X_EXPRESS_PACKAGE_SIDE_CM} cm.`,
      );
    }
  }
  return complete;
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
