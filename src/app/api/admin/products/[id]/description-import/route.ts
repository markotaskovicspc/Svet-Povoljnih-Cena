import { NextResponse } from "next/server";
import { logAudit, requireAdminAction } from "@/lib/admin";
import { db } from "@/lib/db";
import {
  convertDocxDescription,
  validateProductDocument,
} from "@/lib/product-documents.server";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdminAction(["CONTENT", "OPS"]);
  const { id: productId } = await context.params;
  try {
    const product = await db.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!product) {
      return NextResponse.json({ error: "Artikal ne postoji." }, { status: 404 });
    }
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Izaberite DOCX fajl." }, { status: 400 });
    }
    const validated = await validateProductDocument(file, { docxOnly: true });
    const converted = await convertDocxDescription(validated.buffer);
    await logAudit({
      actorId: admin.id,
      action: "product.description.docx-preview",
      entity: "Product",
      entityId: productId,
      diff: { fileName: file.name, sizeBytes: file.size, warnings: converted.warnings },
    });
    return NextResponse.json(converted);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "DOCX opis nije mogao da se uveze.";
    await logAudit({
      actorId: admin.id,
      action: "product.description.docx-preview.error",
      entity: "Product",
      entityId: productId,
      diff: { error: message },
    }).catch(() => undefined);
    return NextResponse.json(
      { error: message },
      { status: 400 },
    );
  }
}
