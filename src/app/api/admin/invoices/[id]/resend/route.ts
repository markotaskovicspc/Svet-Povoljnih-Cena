import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdminAction, logAudit } from "@/lib/admin";
import { issueBuyerReceiptForOrder } from "@/lib/receipts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdminAction(["OPS"]);
  const { id } = await ctx.params;
  const invoice = await db.invoice.findUnique({
    where: { id },
    select: { id: true, orderId: true, number: true },
  });
  if (!invoice) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  const result = await issueBuyerReceiptForOrder(invoice.orderId, {
    sendEmail: true,
    forceEmail: true,
  });
  await logAudit({
    actorId: admin.id,
    action: result.ok ? "invoice.resend" : "invoice.resend.error",
    entity: "Invoice",
    entityId: invoice.id,
    diff: result.ok ? { number: invoice.number } : { error: result.error },
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
