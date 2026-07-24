import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { logAudit, requireAdminAction } from "@/lib/admin";
import { createManualSalesOrder } from "@/lib/admin/sales-order.server";

export async function POST(request: Request) {
  const admin = await requireAdminAction(["OPS"]);
  const input = await request.json().catch(() => null);
  try {
    const order = await createManualSalesOrder(input, admin.id);
    await logAudit({
      actorId: admin.id,
      action: "erp.sales-order.create",
      entity: "Order",
      entityId: order.id,
      diff: { number: order.number, input },
    });
    revalidatePath("/admin/erp/prodajni-nalozi");
    return NextResponse.json({ ok: true, order }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Porudžbina nije kreirana.";
    await logAudit({
      actorId: admin.id,
      action: "erp.sales-order.create.error",
      entity: "Order",
      diff: { input, error: message },
    });
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
