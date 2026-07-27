import { NextResponse } from "next/server";
import { requireAdminAction } from "@/lib/admin";
import {
  buildDispatchNotePdf,
  getDispatchNotePrintData,
} from "@/lib/admin/dispatch-note-print.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  await requireAdminAction(["OPS"]);
  const { id } = await context.params;
  const note = await getDispatchNotePrintData(id);
  if (!note) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  const pdf = buildDispatchNotePdf(note);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="otpremnica-${note.number.replaceAll("/", "-")}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
