import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { ProductAttachmentSection } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { logAudit, requireAdminAction } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProductMediaBucket } from "@/lib/supabase/storage";
import { validateProductDocument } from "@/lib/product-documents.server";

const uploadSchema = z.object({
  section: z.nativeEnum(ProductAttachmentSection).refine(
    (section) => section !== ProductAttachmentSection.GENERAL,
    "Izaberite PDP info sekciju.",
  ),
  label: z.string().trim().min(1).max(160),
});

function refreshProduct(productId: string, slug: string) {
  revalidatePath(`/admin/proizvodi/${productId}`);
  revalidatePath(`/p/${slug}`);
  revalidateTag("catalog-products", { expire: 0 });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdminAction(["CONTENT", "OPS"]);
  const { id: productId } = await context.params;
  let storageKey: string | null = null;
  let createdAttachmentId: string | null = null;
  try {
    const formData = await request.formData();
    const parsed = uploadSchema.safeParse({
      section: formData.get("section"),
      label: formData.get("label"),
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Neispravan unos." },
        { status: 400 },
      );
    }
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Izaberite fajl." }, { status: 400 });
    }
    const [product, validated] = await Promise.all([
      db.product.findUnique({
        where: { id: productId },
        select: { id: true, slug: true },
      }),
      validateProductDocument(file),
    ]);
    if (!product) {
      return NextResponse.json({ error: "Artikal ne postoji." }, { status: 404 });
    }
    storageKey = `products/${productId}/documents/${Date.now()}-${randomBytes(10).toString("hex")}.${validated.extension}`;
    const storage = createAdminClient().storage.from(getProductMediaBucket());
    const { error: uploadError } = await storage.upload(
      storageKey,
      validated.buffer,
      {
        contentType: validated.mimeType,
        upsert: false,
      },
    );
    if (uploadError) throw new Error(`Upload nije uspeo: ${uploadError.message}`);

    const maxOrder = await db.productAttachment.aggregate({
      where: {
        productId,
        section: parsed.data.section,
        kind: "DOCUMENT",
      },
      _max: { order: true },
    });
    const attachment = await db.productAttachment.create({
      data: {
        productId,
        section: parsed.data.section,
        kind: "DOCUMENT",
        origin: "ADMIN_UPLOAD",
        label: parsed.data.label,
        url: storageKey,
        mimeType: validated.mimeType,
        sizeBytes: validated.sizeBytes,
        order: (maxOrder._max.order ?? -1) + 1,
      },
      select: { id: true, label: true, section: true, order: true },
    });
    createdAttachmentId = attachment.id;
    await logAudit({
      actorId: admin.id,
      action: "product.attachment.create",
      entity: "ProductAttachment",
      entityId: attachment.id,
      diff: {
        productId,
        section: attachment.section,
        label: attachment.label,
        mimeType: validated.mimeType,
        sizeBytes: validated.sizeBytes,
        storageKey,
      },
    });
    refreshProduct(productId, product.slug);
    return NextResponse.json({ attachment });
  } catch (error) {
    if (storageKey) {
      let canRemoveStorage = !createdAttachmentId;
      if (createdAttachmentId) {
        canRemoveStorage = await db.productAttachment
          .deleteMany({
            where: {
              id: createdAttachmentId,
              productId,
              origin: "ADMIN_UPLOAD",
            },
          })
          .then(() => true)
          .catch(() => false);
      }
      if (canRemoveStorage) {
        await createAdminClient()
          .storage
          .from(getProductMediaBucket())
          .remove([storageKey])
          .catch(() => undefined);
      }
    }
    const message =
      error instanceof Error ? error.message : "Dokument nije dodat.";
    await logAudit({
      actorId: admin.id,
      action: "product.attachment.create.error",
      entity: "ProductAttachment",
      diff: { productId, error: message },
    }).catch(() => undefined);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
