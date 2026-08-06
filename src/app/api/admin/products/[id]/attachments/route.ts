import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { ProductAttachmentSection } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { logAudit, requireAdminAction } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getManagedProductMediaStorageKey,
  getProductMediaBucket,
  resolveSupabaseStorageUrl,
} from "@/lib/supabase/storage";
import { validateProductDocument } from "@/lib/product-documents.server";
import { productAttachmentAdminLabel } from "@/lib/product-documents";
import { propagateProductFamilySharedData } from "@/lib/product-family.server";

const uploadSchema = z.object({
  section: z.nativeEnum(ProductAttachmentSection).refine(
    (section) => section !== ProductAttachmentSection.GENERAL,
    "Izaberite PDP info sekciju.",
  ),
});

function refreshProduct(productId: string, slug: string) {
  revalidatePath(`/admin/erp/artikli/${productId}`);
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
  try {
    const formData = await request.formData();
    const parsed = uploadSchema.safeParse({
      section: formData.get("section"),
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
        select: { id: true, sku: true, slug: true },
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

    const label = productAttachmentAdminLabel(product.sku, parsed.data.section);
    const saved = await db.$transaction(async (tx) => {
      const existing = await tx.productAttachment.findMany({
        where: {
          productId,
          section: parsed.data.section,
          kind: "DOCUMENT",
          origin: "ADMIN_UPLOAD",
        },
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      });
      const current = existing[0];
      if (existing.length > 1) {
        await tx.productAttachment.deleteMany({
          where: { id: { in: existing.slice(1).map(({ id }) => id) } },
        });
      }
      if (current) {
        const attachment = await tx.productAttachment.update({
          where: { id: current.id },
          data: {
            label,
            url: storageKey!,
            mimeType: validated.mimeType,
            sizeBytes: validated.sizeBytes,
            syncStatus: "READY",
          },
        });
        await propagateProductFamilySharedData(tx, productId, ["master"]);
        return { attachment, replaced: existing };
      }
      const maxOrder = await tx.productAttachment.aggregate({
        where: {
          productId,
          section: parsed.data.section,
          kind: "DOCUMENT",
        },
        _max: { order: true },
      });
      const attachment = await tx.productAttachment.create({
        data: {
          productId,
          section: parsed.data.section,
          kind: "DOCUMENT",
          origin: "ADMIN_UPLOAD",
          label,
          url: storageKey!,
          mimeType: validated.mimeType,
          sizeBytes: validated.sizeBytes,
          order: (maxOrder._max.order ?? -1) + 1,
        },
      });
      await propagateProductFamilySharedData(tx, productId, ["master"]);
      return { attachment, replaced: [] };
    });
    const replacedStorageKeys = saved.replaced
      .map((attachment) => getManagedProductMediaStorageKey(attachment.url))
      .filter(
        (key): key is string =>
          Boolean(key?.startsWith(`products/${productId}/documents/`)) &&
          key !== storageKey,
      );
    let cleanupError: string | null = null;
    if (replacedStorageKeys.length) {
      const { error } = await storage.remove(replacedStorageKeys);
      cleanupError = error?.message ?? null;
    }
    await logAudit({
      actorId: admin.id,
      action: saved.replaced.length
        ? "product.attachment.replace"
        : "product.attachment.create",
      entity: "ProductAttachment",
      entityId: saved.attachment.id,
      diff: {
        productId,
        section: saved.attachment.section,
        label: saved.attachment.label,
        mimeType: validated.mimeType,
        sizeBytes: validated.sizeBytes,
        storageKey,
        replacedAttachmentIds: saved.replaced.map(({ id }) => id),
        cleanupError,
      },
    });
    refreshProduct(productId, product.slug);
    return NextResponse.json({
      attachment: {
        id: saved.attachment.id,
        section: saved.attachment.section,
        label: saved.attachment.label,
        url: resolveSupabaseStorageUrl(saved.attachment.url),
        order: saved.attachment.order,
        origin: saved.attachment.origin,
        mimeType: saved.attachment.mimeType,
        sizeBytes: saved.attachment.sizeBytes,
      },
    });
  } catch (error) {
    if (storageKey) {
      const savedAttachment = await db.productAttachment.findFirst({
        where: { productId, url: storageKey },
        select: { id: true },
      }).catch(() => null);
      if (!savedAttachment) {
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
