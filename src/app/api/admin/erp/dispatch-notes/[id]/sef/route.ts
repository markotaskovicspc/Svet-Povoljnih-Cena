import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { logAudit, requireAdminAction } from "@/lib/admin";
import { sendDispatchNoteToSef } from "@/lib/admin/dispatch-note.server";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdminAction(["OPS"]);
  const { id } = await context.params;
  try {
    const note = await sendDispatchNoteToSef(id);
    await logAudit({
      actorId: admin.id,
      action: "erp.dispatch-note.sef-send",
      entity: "DispatchNote",
      entityId: id,
      diff: {
        requestId: note.sefRequestId,
        status: note.sefStatus,
      },
    });
    revalidatePath("/admin/erp/otpremnice");
    revalidatePath(`/admin/erp/otpremnice/${id}`);
    return NextResponse.json({
      ok: true,
      message: `Otpremnica ${note.number} je predata Sistemu elektronskih otpremnica.`,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Slanje na SEF nije uspelo.";
    await logAudit({
      actorId: admin.id,
      action: "erp.dispatch-note.sef-send.error",
      entity: "DispatchNote",
      entityId: id,
      diff: { error: message },
    });
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
