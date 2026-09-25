import { packedItemsContent, type PackedItem } from "@/lib/courier/parcel-contents";
import { packageVolumetricDimension } from "@/lib/delivery-tariff";

export const MAX_COURIER_PACKAGES = 99;
export const MAX_X_EXPRESS_PACKAGE_WEIGHT_KG = 30;
export const MAX_X_EXPRESS_PACKAGE_SIDE_CM = 60;
export const MAX_MYGLS_PACKAGE_WEIGHT_KG = 40;
export const MAX_MYGLS_PACKAGE_SIDE_CM = 200;
export const MAX_MYGLS_PACKAGE_GIRTH_CM = 300;

export type PhysicalPackage = {
  packedItems?: PackedItem[];
  routingMeasurements?: { weightKg: number | null; widthCm: number | null; depthCm: number | null; heightCm: number | null };
  packedQuantity?: number;
  packageNo: number;
  orderItemId?: string | null;
  content?: string | null;
  weightKg: number | null;
  widthCm: number | null;
  depthCm: number | null;
  heightCm: number | null;
};

export type CompletePhysicalPackage = {
  packedItems?: PackedItem[];
  packedQuantity?: number;
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
  sku?: string;
  supplierName?: string | null;
  collectionName?: string | null;
  categoryName?: string | null;
  color1?: string | null;
  color2?: string | null;
  unitPriceSale?: unknown;
  assemblyPrice?: unknown;
  withAssembly?: boolean;
  product?: {
    supplier?: { name: string } | null;
    collection?: { name: string } | null;
    name?: string;
    barcode?: string | null;
    colorPrimary?: string | null;
    colorSecondary?: string | null;
    courierUnitsPerBox?: number | null;
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

/** An explicit courier carton groups units; inbound packQty alone never does. */
export function courierPackageCount(quantity: unknown, unitsPerBox: unknown = 1) {
  return Math.ceil((positiveInteger(quantity) ?? 1) / (positiveInteger(unitsPerBox) ?? 1));
}

/**
 * Returns the weight of one customer-facing package. Transport-carton weight
 * is deliberately ignored: dividing it by `packQty` would only be an estimate
 * and can accidentally declare the whole carton as one courier package when
 * catalogue metadata is incomplete.
 */
export function courierUnitWeightKg(
  product: PackageSourceItem["product"],
) {
  return (
    positiveNumber(product?.grossWeightKg) ??
    positiveNumber(product?.weightKg)
  );
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
 * Expands order lines into full courier cartons and a separate remainder.
 * Full cartons use transport measurements; a single remainder uses unit measurements.
 * Missing values intentionally remain null so an operator must enter real
 * measurements before a provider request can be sent.
 */
export function derivePhysicalPackages(
  items: readonly PackageSourceItem[],
  options: { consolidatePompea?: boolean } = {},
): PhysicalPackage[] {
  const packages: PhysicalPackage[] = [];
  const pompea = options.consolidatePompea === false ? [] : items.filter(isPompeaItem);
  let consolidated = false;
  for (const item of items) {
    if (pompea.includes(item)) {
      if (!consolidated) packages.push(buildPompeaParcel(pompea, packages.length + 1));
      consolidated = true;
      continue;
    }
    const unitsPerBox = positiveInteger(item.product?.courierUnitsPerBox) ?? 1;
    const quantity = positiveInteger(item.qty) ?? 1;
    const count = courierPackageCount(quantity, unitsPerBox);
    for (let index = 0; index < count; index += 1) {
      const packedQuantity = Math.min(unitsPerBox, quantity - index * unitsPerBox);
      const multiple = packedQuantity > 1;
      const matchingCarton = item.product?.packQty === packedQuantity;
      packages.push({
        packedQuantity,
        packageNo: packages.length + 1,
        orderItemId: item.id,
        content: item.name,
        weightKg: multiple ? (matchingCarton ? positiveNumber(item.product?.packGrossWeightKg) : null) : courierUnitWeightKg(item.product),
        widthCm: positiveNumber(multiple ? item.product?.packWidthCm : item.product?.unitPackWidthCm),
        depthCm: positiveNumber(multiple ? item.product?.packDepthCm : item.product?.unitPackDepthCm),
        heightCm: positiveNumber(multiple ? item.product?.packHeightCm : item.product?.unitPackHeightCm),
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
      ...(pkg.packedItems ? { packedItems: pkg.packedItems } : {}),
      packedQuantity: pkg.packedQuantity,
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
      ...(pkg.packedItems ? { packedItems: pkg.packedItems } : {}),
      packedQuantity: pkg.packedQuantity,
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

/** Brand matching also covers the current Modital catalogue without grouping other brands. */
export function isPompeaItem(item: PackageSourceItem): boolean {
  return [item.product?.supplier?.name, item.supplierName, item.product?.collection?.name,
    item.collectionName, item.product?.name, item.name].some(value => /^pompea(?:\b|_)/iu.test(value?.trim() ?? ""));
}

function buildPompeaParcel(items: readonly PackageSourceItem[], packageNo: number): PhysicalPackage {
  const packedItems: PackedItem[] = items.map(item => {
    const price = item.unitPriceSale == null ? null : Number(item.unitPriceSale);
    const assembly = item.withAssembly ? Number(item.assemblyPrice ?? 0) : 0;
    return {
      orderItemId: item.id, quantity: positiveInteger(item.qty) ?? 1,
      sku: item.sku ?? "", name: item.name,
      barcode: item.product?.barcode ?? null, categoryName: item.categoryName ?? null,
      color1: item.product?.colorPrimary ?? item.color1 ?? null,
      color2: item.product?.colorSecondary ?? item.color2 ?? null,
      unitValue: price != null && Number.isFinite(price + assembly) ? price + assembly : null,
    };
  });
  const packedQuantity = packedItems.reduce((sum, item) => sum + item.quantity, 0);
  const maximum = (key: "unitPackWidthCm" | "unitPackDepthCm" | "unitPackHeightCm") => {
    const values = items.map(item => positiveNumber(item.product?.[key]));
    return values.some(value => value != null) ? Math.max(...values.map(value => value ?? 0)) : null;
  };
  const weights = items.map(item => courierUnitWeightKg(item.product));
  const routingMeasurements = {
    weightKg: weights.every(value => value != null) ? items.reduce((sum, item, i) => sum + weights[i]! * (positiveInteger(item.qty) ?? 1), 0) : null,
    widthCm: maximum("unitPackWidthCm"), depthCm: maximum("unitPackDepthCm"), heightCm: maximum("unitPackHeightCm"),
  };
  return {
    packageNo, orderItemId: items[0].id, packedItems, packedQuantity,
    content: packedItemsContent(packedItems),
    // Multiple soft goods need one measured shipping parcel, not multiplied unit dimensions.
    ...(packedQuantity === 1 ? routingMeasurements : { weightKg: null, widthCm: null, depthCm: null, heightCm: null }),
    routingMeasurements,
  };
}
