import { NextResponse } from "next/server";
import { requireAdminAction } from "@/lib/admin";
import { buildBuyerReceiptPdfForInvoice } from "@/lib/receipts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await requireAdminAction(["OPS"]);
  const { id } = await ctx.params;
  const result = await buildBuyerReceiptPdfForInvoice(id);
  if (!result) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  return new Response(new Uint8Array(result.bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${result.invoice.number}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
