import type { ShipmentService } from "@prisma/client";

export interface PackageRouteInput {
  shippingMethod: "KURIR" | "KAMION";
  items: {
    withAssembly: boolean;
    qty?: number;
    packQty?: number | null;
    packWidthCm?: number | null;
    packDepthCm?: number | null;
    packHeightCm?: number | null;
    packGrossWeightKg?: number | null;
  }[];
}

export type PackageCourier = "GLS" | "X_EXPRESS";

export type RoutedPackage = {
  packageIndex: number;
  courier: PackageCourier;
  label: string;
  bulky: boolean;
};

export type CourierRoutingResolution =
  | { kind: "single"; provider: "MYGLS" | "X_EXPRESS" }
  | { kind: "mixed" }
  | { kind: "invalid_dimensions" };

export const X_EXPRESS_MAX_PACKAGE_WEIGHT_KG = 30;
export const X_EXPRESS_MAX_PACKAGE_SIDE_CM = 60;

function expandedPackages(order: PackageRouteInput) {
  return order.items.flatMap((item) => {
    const packageCount = Math.max(
      1,
      Math.ceil((item.qty ?? 1) / Math.max(item.packQty ?? 1, 1)),
    );
    const largestDimension = Math.max(
      item.packWidthCm ?? 0,
      item.packDepthCm ?? 0,
      item.packHeightCm ?? 0,
    );
    const bulky =
      largestDimension > X_EXPRESS_MAX_PACKAGE_SIDE_CM ||
      (item.packGrossWeightKg ?? 0) > X_EXPRESS_MAX_PACKAGE_WEIGHT_KG;
    return Array.from({ length: packageCount }, () => ({ bulky }));
  });
}

/**
 * Resolves the launch routing rule for an order or a selected set of lines.
 * Automatic routing is deliberately blocked when a catalogue dimension or
 * package weight is missing: treating unknown measurements as zero could send
 * a large parcel to the wrong courier.
 */
export function resolveCourierProvider(
  order: PackageRouteInput,
): CourierRoutingResolution {
  const providers = new Set<"MYGLS" | "X_EXPRESS">();
  for (const item of order.items) {
    const dimensions = [
      item.packWidthCm,
      item.packDepthCm,
      item.packHeightCm,
    ].map(Number);
    const weightKg = Number(item.packGrossWeightKg);
    if (
      dimensions.some((value) => !Number.isFinite(value) || value <= 0) ||
      !Number.isFinite(weightKg) ||
      weightKg <= 0
    ) {
      return { kind: "invalid_dimensions" };
    }
    providers.add(
      Math.max(...dimensions) > X_EXPRESS_MAX_PACKAGE_SIDE_CM ||
        weightKg > X_EXPRESS_MAX_PACKAGE_WEIGHT_KG
        ? "MYGLS"
        : "X_EXPRESS",
    );
  }
  if (!providers.size) return { kind: "invalid_dimensions" };
  if (providers.size > 1) return { kind: "mixed" };
  return { kind: "single", provider: [...providers][0]! };
}

/**
 * Document routing:
 * - packages at or below 30 kg and 60 cm on every side go through X Express;
 * - packages over 30 kg or with any side over 60 cm go through MyGLS;
 * The legacy shipping-method value does not override the package dimensions.
 * Labels are numbered independently per courier (1/N, 2/N, ...).
 */
export function routePackages(order: PackageRouteInput): RoutedPackage[] {
  const packages = expandedPackages(order);
  const couriers = packages.map(
    (item): PackageCourier => (item.bulky ? "GLS" : "X_EXPRESS"),
  );
  const totals = couriers.reduce<Record<PackageCourier, number>>(
    (counts, courier) => ({ ...counts, [courier]: counts[courier] + 1 }),
    { GLS: 0, X_EXPRESS: 0 },
  );
  const sequence: Record<PackageCourier, number> = { GLS: 0, X_EXPRESS: 0 };
  return packages.map((item, packageIndex) => {
    const courier = couriers[packageIndex];
    sequence[courier] += 1;
    return {
      packageIndex,
      courier,
      label: `${sequence[courier]}/${totals[courier]}`,
      bulky: item.bulky,
    };
  });
}

export function routeService(order: PackageRouteInput): ShipmentService {
  return routePackages(order).some((item) => item.courier === "GLS")
    ? "COURIER_BULKY"
    : "COURIER_SMALL";
}
