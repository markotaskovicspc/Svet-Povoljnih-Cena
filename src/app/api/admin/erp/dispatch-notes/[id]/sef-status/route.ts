import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { requireAdminAction, logAudit } from "@/lib/admin";
import { refreshDispatchNoteSef } from "@/lib/admin/dispatch-note.server";
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdminAction(["OPS"]), { id } = await params;
  try {
    const doc = await refreshDispatchNoteSef(id);
    await logAudit({ actorId: actor.id, action: "eotpremnica.status.refresh", entity: "DispatchNote", entityId: id, diff: { status: doc.sefStatus, documentId: doc.sefDocumentId } });
    revalidatePath(`/admin/erp/otpremnice/${id}`);
    return NextResponse.json({ ok: true, message: `eOtpremnica status: ${doc.sefStatus}.` });
  } catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Provera nije uspela." }, { status: 400 }); }
}
