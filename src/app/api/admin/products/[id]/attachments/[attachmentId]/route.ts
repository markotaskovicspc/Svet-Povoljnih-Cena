import { NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { logAudit, requireAdminAction } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getManagedProductMediaStorageKey,
  getProductMediaBucket,
} from "@/lib/supabase/storage";

const patchSchema = z.object({
  label: z.string().trim().min(1).max(160).optional(),
  direction: z.enum(["up", "down"]).optional(),
}).refine((input) => input.label !== undefined || input.direction !== undefined, {
  message: "Nema izmene za čuvanje.",
});

type RouteContext = {
  params: Promise<{ id: string; attachmentId: string }>;
};

function refreshProduct(productId: string, slug: string) {
  revalidatePath(`/admin/erp/artikli/${productId}`);
  revalidatePath(`/p/${slug}`);
  revalidateTag("catalog-products", { expire: 0 });
}

export async function PATCH(request: Request, context: RouteContext) {
  const admin = await requireAdminAction(["CONTENT", "OPS"]);
  const { id: productId, attachmentId } = await context.params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Neispravan unos." },
      { status: 400 },
    );
  }
  const attachment = await db.productAttachment.findFirst({
    where: { id: attachmentId, productId, origin: "ADMIN_UPLOAD" },
    include: { product: { select: { slug: true } } },
  });
  if (!attachment) {
    return NextResponse.json(
      { error: "Admin dokument ne postoji ili je dobavljački zaštićen." },
      { status: 404 },
    );
  }
  await db.$transaction(async (tx) => {
    if (parsed.data.direction) {
      const neighbour = await tx.productAttachment.findFirst({
        where: {
          productId,
          section: attachment.section,
          kind: attachment.kind,
          origin: "ADMIN_UPLOAD",
          order:
            parsed.data.direction === "up"
              ? { lt: attachment.order }
              : { gt: attachment.order },
        },
        orderBy: {
          order: parsed.data.direction === "up" ? "desc" : "asc",
        },
      });
      if (neighbour) {
        await tx.productAttachment.update({
          where: { id: attachment.id },
          data: { order: -1 },
        });
        await tx.productAttachment.update({
          where: { id: neighbour.id },
          data: { order: attachment.order },
        });
        await tx.productAttachment.update({
          where: { id: attachment.id },
          data: { order: neighbour.order },
        });
      }
    }
    if (parsed.data.label !== undefined) {
      await tx.productAttachment.update({
        where: { id: attachment.id },
        data: { label: parsed.data.label },
      });
    }
  });
  await logAudit({
    actorId: admin.id,
    action: "product.attachment.update",
    entity: "ProductAttachment",
    entityId: attachment.id,
    diff: { productId, ...parsed.data },
  });
  refreshProduct(productId, attachment.product.slug);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const admin = await requireAdminAction(["CONTENT", "OPS"]);
  const { id: productId, attachmentId } = await context.params;
  const attachment = await db.productAttachment.findFirst({
    where: { id: attachmentId, productId, origin: "ADMIN_UPLOAD" },
    include: { product: { select: { slug: true } } },
  });
  if (!attachment) {
    return NextResponse.json(
      { error: "Admin dokument ne postoji ili je dobavljački zaštićen." },
      { status: 404 },
    );
  }
  const storageKey = getManagedProductMediaStorageKey(attachment.url);
  const expectedPrefix = `products/${productId}/documents/`;
  if (!storageKey || !storageKey.startsWith(expectedPrefix)) {
    return NextResponse.json(
      { error: "Storage ključ ne pripada dokumentima ovog artikla; zapis nije obrisan." },
      { status: 409 },
    );
  }
  const { error: storageError } = await createAdminClient()
    .storage
    .from(getProductMediaBucket())
    .remove([storageKey]);
  if (storageError) {
    return NextResponse.json(
      { error: `Storage nije obrisan; zapis je sačuvan: ${storageError.message}` },
      { status: 502 },
    );
  }
  await db.productAttachment.delete({ where: { id: attachment.id } });
  await logAudit({
    actorId: admin.id,
    action: "product.attachment.delete",
    entity: "ProductAttachment",
    entityId: attachment.id,
    diff: { productId, storageKey },
  });
  refreshProduct(productId, attachment.product.slug);
  return NextResponse.json({ ok: true });
}
