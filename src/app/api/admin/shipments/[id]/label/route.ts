import { NextResponse } from "next/server";
import { requireAdminAction } from "@/lib/admin";
import { db } from "@/lib/db";
import { downloadMyGlsLabelPdf, MYGLS_PROVIDER } from "@/lib/mygls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await requireAdminAction(["OPS"]);
  const { id } = await ctx.params;
  const shipment = await db.shipment.findUnique({
    where: { id },
    select: {
      provider: true,
      trackingNo: true,
      labelObjectKey: true,
      labelMimeType: true,
    },
  });
  if (!shipment || shipment.provider !== MYGLS_PROVIDER || !shipment.labelObjectKey) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const pdf = await downloadMyGlsLabelPdf(shipment.labelObjectKey);
  return new NextResponse(pdf, {
    headers: {
      "content-type": shipment.labelMimeType ?? "application/pdf",
      "content-disposition": `inline; filename="mygls-${shipment.trackingNo ?? id}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
