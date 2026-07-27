import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { logAudit, requireAdminAction } from "@/lib/admin";
import { postDispatchNotes } from "@/lib/admin/dispatch-note.server";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdminAction(["OPS"]);
  const { id } = await context.params;
  try {
    const posted = await postDispatchNotes([id], admin.id);
    await logAudit({
      actorId: admin.id,
      action: "erp.dispatch-note.post",
      entity: "DispatchNote",
      entityId: id,
      diff: { posted },
    });
    revalidatePath("/admin/erp/otpremnice");
    revalidatePath(`/admin/erp/otpremnice/${id}`);
    return NextResponse.json({
      ok: true,
      message: posted.length
        ? `Otpremnica ${posted[0]} je proknjižena.`
        : "Otpremnica je već proknjižena.",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Knjiženje nije uspelo.";
    await logAudit({
      actorId: admin.id,
      action: "erp.dispatch-note.post.error",
      entity: "DispatchNote",
      entityId: id,
      diff: { error: message },
    });
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
