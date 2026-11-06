import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { logAudit, requireAdminAction } from "@/lib/admin";
import { validateProductDocument } from "@/lib/product-documents.server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getErpDocumentsBucket } from "@/lib/supabase/storage";
import type { ProcurementDocumentOwnerType } from "@/lib/admin/procurement-documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uploadSchema = z.object({
  ownerType: z.enum(["purchaseOrder", "inboundInvoice"]),
  ownerId: z.string().min(1).max(100),
});

function cleanFilename(name: string) {
  const base = name.replaceAll("\\", "/").split("/").at(-1) ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!cleaned) throw new Error("Naziv fajla nije ispravan.");
  return cleaned.slice(0, 255);
}

function documentView(document: {
  id: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
  purchaseOrderId: string | null;
  inboundInvoiceId: string | null;
}) {
  return {
    id: document.id,
    originalFilename: document.originalFilename,
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes,
    createdAt: document.createdAt.toISOString(),
    ownerType: (document.purchaseOrderId ? "purchaseOrder" : "inboundInvoice") satisfies ProcurementDocumentOwnerType,
  };
}

export async function POST(request: Request) {
  const admin = await requireAdminAction(["OPS"]);
  let storageKey: string | null = null;
  try {
    const formData = await request.formData();
    const parsed = uploadSchema.safeParse({
      ownerType: formData.get("ownerType"),
      ownerId: formData.get("ownerId"),
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Izaberite porudžbenicu ili prijemnicu." },
        { status: 400 },
      );
    }
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Izaberite dokument." }, { status: 400 });
    }

    const filename = cleanFilename(file.name);
    const { ownerType, ownerId } = parsed.data;
    const [owner, validated] = await Promise.all([
      ownerType === "purchaseOrder"
        ? db.purchaseOrder.findUnique({
            where: { id: ownerId },
            select: { id: true, number: true },
          })
        : db.inboundInvoice.findUnique({
            where: { id: ownerId },
            select: { id: true, number: true, purchaseOrderId: true },
          }),
      validateProductDocument(file),
    ]);
    if (!owner) {
      return NextResponse.json(
        { error: ownerType === "purchaseOrder" ? "Porudžbenica ne postoji." : "Prijemnica ne postoji." },
        { status: 404 },
      );
    }

    const extension = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
    if (!extension) throw new Error("Ekstenzija fajla nije ispravna.");
    const ownerSegment = ownerId.replace(/[^a-zA-Z0-9_-]/g, "_");
    storageKey = `procurement/${ownerType}/${ownerSegment}/${Date.now()}-${randomBytes(10).toString("hex")}.${extension}`;
    const storage = createAdminClient().storage.from(getErpDocumentsBucket());
    const { error: uploadError } = await storage.upload(storageKey, validated.buffer, {
      contentType: validated.mimeType,
      upsert: false,
    });
    if (uploadError) {
      return NextResponse.json(
        { error: `Upload dokumenta nije uspeo: ${uploadError.message}` },
        { status: 502 },
      );
    }

    const document = await db.procurementDocument.create({
      data: {
        purchaseOrderId: ownerType === "purchaseOrder" ? owner.id : null,
        inboundInvoiceId: ownerType === "inboundInvoice" ? owner.id : null,
        originalFilename: filename,
        storageKey,
        mimeType: validated.mimeType,
        sizeBytes: validated.sizeBytes,
      },
    });
    const relatedPurchaseOrderId =
      ownerType === "purchaseOrder"
        ? owner.id
        : (owner as { purchaseOrderId: string | null }).purchaseOrderId;
    revalidatePath(
      ownerType === "purchaseOrder"
        ? `/admin/erp/porudzbenice/${owner.id}`
        : `/admin/erp/ulazne-fakture/${owner.id}`,
    );
    if (relatedPurchaseOrderId) {
      revalidatePath(`/admin/erp/porudzbenice/${relatedPurchaseOrderId}`);
      const linkedReceipt = await db.inboundInvoice.findFirst({
        where: { purchaseOrderId: relatedPurchaseOrderId },
        select: { id: true },
      });
      if (linkedReceipt) {
        revalidatePath(`/admin/erp/ulazne-fakture/${linkedReceipt.id}`);
      }
    }
    await logAudit({
      actorId: admin.id,
      action: "procurement.document.create",
      entity: "ProcurementDocument",
      entityId: document.id,
      diff: {
        ownerType,
        ownerId,
        filename,
        mimeType: validated.mimeType,
        sizeBytes: validated.sizeBytes,
        storageKey,
      },
    });
    return NextResponse.json({ document: documentView(document) }, { status: 201 });
  } catch (error) {
    if (storageKey) {
      const saved = await db.procurementDocument.findUnique({
        where: { storageKey },
        select: { id: true },
      }).catch(() => null);
      if (!saved) {
        await createAdminClient()
          .storage.from(getErpDocumentsBucket())
          .remove([storageKey])
          .catch(() => undefined);
      }
    }
    const message =
      error instanceof Error ? error.message : "Dokument nije dodat.";
    await logAudit({
      actorId: admin.id,
      action: "procurement.document.create.error",
      entity: "ProcurementDocument",
      diff: { error: message },
    }).catch(() => undefined);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
