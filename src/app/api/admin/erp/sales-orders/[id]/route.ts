import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { logAudit, requireAdminAction } from "@/lib/admin";
import {
  deleteManualSalesOrders,
  updateManualSalesOrder,
} from "@/lib/admin/sales-order.server";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdminAction(["OPS"]);
  const { id } = await context.params;
  const input = await request.json().catch(() => null);
  try {
    const order = await updateManualSalesOrder(id, input, admin.id);
    await logAudit({
      actorId: admin.id,
      action: "erp.sales-order.update",
      entity: "Order",
      entityId: id,
      diff: { input },
    });
    revalidatePath("/admin/erp/prodajni-nalozi");
    revalidatePath(`/admin/erp/prodajni-nalozi/${id}`);
    return NextResponse.json({ ok: true, order });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Porudžbina nije sačuvana.";
    await logAudit({
      actorId: admin.id,
      action: "erp.sales-order.update.error",
      entity: "Order",
      entityId: id,
      diff: { input, error: message },
    });
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdminAction(["OPS"]);
  const { id } = await context.params;
  try {
    const [deleted] = await deleteManualSalesOrders([id], admin.id);
    await logAudit({
      actorId: admin.id,
      action: "erp.sales-order.delete",
      entity: "Order",
      entityId: id,
      diff: { number: deleted.number },
    });
    revalidatePath("/admin/erp/prodajni-nalozi");
    return NextResponse.json({ ok: true, deleted });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Porudžbina nije obrisana.";
    await logAudit({
      actorId: admin.id,
      action: "erp.sales-order.delete.error",
      entity: "Order",
      entityId: id,
      diff: { error: message },
    });
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
