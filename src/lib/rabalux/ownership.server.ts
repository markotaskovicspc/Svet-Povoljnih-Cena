import "server-only";

import type { Prisma } from "@prisma/client";
import {
  mergeOverrideFields,
  type RabaluxOverrideGroup,
} from "./ownership";

export async function lockSupplierOwnedFields(
  tx: Prisma.TransactionClient,
  productId: string,
  actorId: string,
  fields: RabaluxOverrideGroup[],
) {
  const product = await tx.product.findUnique({
    where: { id: productId },
    select: { supplierId: true, syncOverrides: true },
  });
  if (!product?.supplierId || !fields.length) return;
  await tx.product.update({
    where: { id: productId },
    data: {
      syncOverrides: mergeOverrideFields(product.syncOverrides, fields, actorId),
    },
  });
}
