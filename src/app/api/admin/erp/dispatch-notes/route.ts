import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { logAudit, requireAdminAction } from "@/lib/admin";
import { createDispatchNote } from "@/lib/admin/dispatch-note.server";

export async function POST(request: Request) {
  const admin = await requireAdminAction(["OPS"]);
  const input = await request.json().catch(() => null);
  try {
    const note = await createDispatchNote(input, admin.id);
    await logAudit({
      actorId: admin.id,
      action: "erp.dispatch-note.create",
      entity: "DispatchNote",
      entityId: note.id,
      diff: { number: note.number, input },
    });
    revalidatePath("/admin/erp/otpremnice");
    return NextResponse.json({ ok: true, note }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Otpremnica nije kreirana.";
    await logAudit({
      actorId: admin.id,
      action: "erp.dispatch-note.create.error",
      entity: "DispatchNote",
      diff: { input, error: message },
    });
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
