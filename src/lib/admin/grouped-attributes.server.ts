import "server-only";
import type { Prisma } from "@prisma/client";

export const attributeAssignmentsSelect = {
  option: { include: { section: true } },
} satisfies Prisma.ProductAttributeAssignmentSelect;

export async function saveProductAttributeSelection(
  tx: Prisma.TransactionClient, productId: string, optionIds: string[],
) {
  const ids = [...new Set(optionIds)];
  const existing = await tx.productAttributeAssignment.findMany({
    where: { productId }, select: { optionId: true },
  });
  const previouslySelected = new Set(existing.map((item) => item.optionId));
  const options = await tx.attributeOption.findMany({
    where: { id: { in: ids } }, include: { section: true },
  });
  if (options.length !== ids.length || options.some((option) =>
    (!option.active || !option.section.active) && !previouslySelected.has(option.id))) {
    throw new Error("Izabrani atribut više nije dostupan. Osvežite stranicu.");
  }
  await tx.productAttributeAssignment.deleteMany({
    where: { productId, optionId: { notIn: ids } },
  });
  if (ids.length) await tx.productAttributeAssignment.createMany({
    data: ids.map((optionId) => ({ productId, optionId })), skipDuplicates: true,
  });
}
