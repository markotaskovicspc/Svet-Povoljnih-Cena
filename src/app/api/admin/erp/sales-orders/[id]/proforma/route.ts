import { NextResponse } from "next/server";
import { requireAdminAction } from "@/lib/admin";
import {
  buildVpProformaPdf,
  getVpProformaData,
} from "@/lib/admin/sales-order-proforma.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  await requireAdminAction(["OPS"]);
  const { id } = await context.params;
  const order = await getVpProformaData(id);
  if (!order) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  try {
    const pdf = buildVpProformaPdf(order);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="vp-predracun-${order.number}.pdf"`,
        "cache-control": "private, no-store, max-age=0",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "VP predračun nije moguće generisati.",
      },
      { status: 400 },
    );
  }
}
