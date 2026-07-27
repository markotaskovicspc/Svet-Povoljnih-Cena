import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { logAudit, requireAdminAction } from "@/lib/admin";
import {
  deleteDispatchNotes,
  updateDispatchNote,
} from "@/lib/admin/dispatch-note.server";

function revalidateDispatch(id: string) {
  revalidatePath("/admin/erp/otpremnice");
  revalidatePath(`/admin/erp/otpremnice/${id}`);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdminAction(["OPS"]);
  const { id } = await context.params;
  const input = await request.json().catch(() => null);
  try {
    const note = await updateDispatchNote(id, input, admin.id);
    await logAudit({
      actorId: admin.id,
      action: "erp.dispatch-note.update",
      entity: "DispatchNote",
      entityId: id,
      diff: { input },
    });
    revalidateDispatch(id);
    return NextResponse.json({ ok: true, note });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Otpremnica nije sačuvana.";
    await logAudit({
      actorId: admin.id,
      action: "erp.dispatch-note.update.error",
      entity: "DispatchNote",
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
    const [deleted] = await deleteDispatchNotes([id]);
    await logAudit({
      actorId: admin.id,
      action: "erp.dispatch-note.delete",
      entity: "DispatchNote",
      entityId: id,
      diff: { number: deleted.number },
    });
    revalidateDispatch(id);
    return NextResponse.json({
      ok: true,
      deleted,
      message: `Otpremnica ${deleted.number} je obrisana.`,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Otpremnica nije obrisana.";
    await logAudit({
      actorId: admin.id,
      action: "erp.dispatch-note.delete.error",
      entity: "DispatchNote",
      entityId: id,
      diff: { error: message },
    });
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
