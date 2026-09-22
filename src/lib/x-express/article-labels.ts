import type { ShipmentPurpose } from "@prisma/client";
import type { PhysicalPackage } from "@/lib/courier/packages";
import { readShipmentAssignment } from "@/lib/courier/shipment-assignment";
import { sanitizeProviderContent } from "./payload";

export const xExpressLabelItemSelect = {
  id: true, name: true, qty: true, sku: true,
  product: { select: { barcode: true } },
} as const;

export type XExpressArticleItem = {
  id?: string;
  name: string;
  qty: number;
  sku?: string;
  product?: { barcode: string | null } | null;
};

export type XExpressArticleLabel = { name: string; sku: string | null; barcode: string | null };

function article(item: XExpressArticleItem): XExpressArticleLabel {
  return { name: item.name, sku: item.sku?.trim() || null, barcode: item.product?.barcode?.replace(/\s/g, "") || null };
}

/** Snapshot by tracking code; PDF rendering must never guess from API response order. */
export function buildXExpressArticleLabels(args: {
  codes: readonly string[];
  packages?: readonly PhysicalPackage[];
  items: readonly XExpressArticleItem[];
  purpose: ShipmentPurpose;
}) {
  return args.codes.flatMap((Code, index) => {
    const pkg = args.packages?.[index];
    const item = pkg?.orderItemId
      ? args.items.find((item) => item.id === pkg.orderItemId)
      : args.items.length === 1 ? args.items[0] : undefined;
    if (!item) return [];
    const customPart = args.purpose === "RECLAMATION_REPLACEMENT" &&
      pkg?.content?.trim() && pkg.content.trim() !== item?.name.trim();
    return [{
      Code,
      ...(item && !customPart ? article(item) : {
        name: pkg?.content?.trim() || "Roba", sku: null, barcode: null,
      }),
    }];
  });
}

export function resolveXExpressArticleLabel(args: {
  raw: unknown;
  code: string;
  items: readonly XExpressArticleItem[];
  content: string;
  orderItemId?: string | null;
  purpose?: ShipmentPurpose;
}): XExpressArticleLabel | null {
  const raw = args.raw as { articleLabels?: unknown } | null;
  if (Array.isArray(raw?.articleLabels)) {
    const entry = raw.articleLabels.find((value) => value?.Code === args.code);
    if (entry && typeof entry.name === "string" &&
        (entry.sku === null || typeof entry.sku === "string") &&
        (entry.barcode === null || typeof entry.barcode === "string")) {
      return { name: entry.name, sku: entry.sku, barcode: entry.barcode };
    }
  }
  const assignment = readShipmentAssignment(args.raw);
  const items = assignment
    ? args.items.filter((item) => item.id && assignment.orderItemIds.includes(item.id))
    : args.items;
  const matches = args.orderItemId
    ? items.filter((item) => item.id === args.orderItemId)
    : items.filter((item) => matchesContent(item.name, args.content));
  const item = matches.length === 1 ? matches[0] : undefined;
  if (!item || (args.purpose === "RECLAMATION_REPLACEMENT" && !matchesContent(item.name, args.content))) return null;
  return article(item);
}

function matchesContent(name: string, content: string) {
  return name.trim() === content.trim() || sanitizeProviderContent(name, 50) === content.trim();
}
