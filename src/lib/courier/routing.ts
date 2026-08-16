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

export type RoutedSmallParcelProvider = "MYGLS" | "X_EXPRESS";

export type RoutedPackage = {
  packageIndex: number;
  courier: PackageCourier;
  label: string;
  bulky: boolean;
};

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
    const bulky = largestDimension > 60;
    return Array.from({ length: packageCount }, () => ({ bulky }));
  });
}

/**
 * Client-approved launch routing:
 * - packages at or below 60 cm on every side go through X Express;
 * - packages with any side over 60 cm go through GLS;
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

export function packageCourierForProvider(
  provider: RoutedSmallParcelProvider,
): PackageCourier {
  return provider === "MYGLS" ? "GLS" : "X_EXPRESS";
}

/**
 * Resolve a single provider only when every physical package follows the same
 * client-approved 60 cm rule. Mixed orders intentionally return null so callers cannot silently
 * send every package to whichever global provider happened to be selected.
 */
export function singleProviderForOrder(
  order: PackageRouteInput,
): RoutedSmallParcelProvider | null {
  const providers = new Set(
    routePackages(order).map((item) =>
      item.courier === "GLS" ? "MYGLS" : "X_EXPRESS",
    ),
  );
  return providers.size === 1
    ? (providers.values().next().value as RoutedSmallParcelProvider)
    : null;
}
