import { NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { logAudit, requireAdminAction } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getManagedProductMediaStorageKey,
  getProductMediaBucket,
} from "@/lib/supabase/storage";

type RouteContext = {
  params: Promise<{ id: string; attachmentId: string }>;
};

function refreshProduct(productId: string, slug: string) {
  revalidatePath(`/admin/erp/artikli/${productId}`);
  revalidatePath(`/p/${slug}`);
  revalidateTag("catalog-products", { expire: 0 });
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
