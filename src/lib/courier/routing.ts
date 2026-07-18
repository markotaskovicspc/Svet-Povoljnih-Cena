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
      order.shippingMethod === "KAMION" ||
      item.withAssembly ||
      largestDimension > 60 ||
      (item.packGrossWeightKg ?? 0) > 30;
    return Array.from({ length: packageCount }, () => ({ bulky }));
  });
}

/**
 * Document routing:
 * - a dimension over 60 cm or weight over 30 kg is bulky;
 * - all-small orders go through X Express;
 * - bulky orders plus zero/one small package go entirely through GLS;
 * - with two or more small packages, bulky packages go through GLS and the
 *   small packages go through X Express.
 * Labels are numbered independently per courier (1/N, 2/N, ...).
 */
export function routePackages(order: PackageRouteInput): RoutedPackage[] {
  const packages = expandedPackages(order);
  const bulkyCount = packages.filter((item) => item.bulky).length;
  const smallCount = packages.length - bulkyCount;
  const couriers = packages.map((item): PackageCourier => {
    if (bulkyCount === 0) return "X_EXPRESS";
    if (smallCount <= 1) return "GLS";
    return item.bulky ? "GLS" : "X_EXPRESS";
  });
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
