import "server-only";

import type { Prisma } from "@prisma/client";
import { processRestockWaitlist } from "./restock";
import { db } from "@/lib/db";
import { num } from "@/lib/api/_helpers";
import {
  sendOnSaleAlert,
} from "./send";
import { isEmailSuppressed } from "./tracking";
import { formatProductDisplayName } from "@/lib/product-name";

export async function processEmailAlerts(limit = 100) {
  const onSale = await db.onSaleAlert.findMany({
      where: {
        notifiedAt: null,
        channel: "EMAIL",
        product: { isActive: true },
      },
      take: limit,
      orderBy: { createdAt: "asc" },
      include: {
        user: { select: { id: true, email: true, deletedAt: true } },
        product: alertProductSelect,
      },
    });
  const restock = await processRestockWaitlist(limit);

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const alert of onSale.filter((a) => isProductOnSale(a.product))) {
    if (!alert.user.email || alert.user.deletedAt) {
      skipped += 1;
      continue;
    }
    if (await isEmailSuppressed(alert.user.email).catch(() => false)) {
      skipped += 1;
      continue;
    }
    const result = await sendOnSaleAlert({
      to: alert.user.email,
      userId: alert.user.id,
      product: productForEmail(alert.product),
    });
    if (result.ok) {
      await db.onSaleAlert.update({
        where: { id: alert.id },
        data: { notifiedAt: new Date() },
      });
      sent += 1;
    } else {
      failed += 1;
    }
  }

  return {
    scanned: restock.scanned + onSale.length,
    sent: sent + restock.sent,
    failed: failed + restock.review,
    skipped: skipped + restock.skipped,
    restock,
  };
}

const alertProductSelect = {
  select: {
    id: true,
    sku: true,
    slug: true,
    name: true,
    sizeLabel: true,
    fullPrice: true,
    salePrice: true,
    discountPct: true,
    action: { select: { startsAt: true, endsAt: true } },
  },
} as const;

function productForEmail(product: AlertProductRow) {
  return {
    id: product.id,
    sku: product.sku,
    slug: product.slug,
    name: formatProductDisplayName(product.name, product.sizeLabel),
    fullPrice: num(product.fullPrice),
    salePrice: product.salePrice ? num(product.salePrice) : null,
  };
}

function isProductOnSale(product: AlertProductRow) {
  if (product.salePrice || (product.discountPct ?? 0) > 0) return true;
  if (!product.action) return false;
  const now = new Date();
  return product.action.startsAt <= now && product.action.endsAt >= now;
}

type AlertProductRow = {
  id: string;
  sku: string;
  slug: string;
  name: string;
  sizeLabel: string | null;
  fullPrice: Prisma.Decimal | number | bigint | null | undefined;
  salePrice: Prisma.Decimal | number | bigint | null | undefined;
  discountPct: number | null;
  action: { startsAt: Date; endsAt: Date } | null;
};
