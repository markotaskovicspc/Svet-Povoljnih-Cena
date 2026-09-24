import { NextResponse } from "next/server";
import { requireAdminAction } from "@/lib/admin";
import { db } from "@/lib/db";
import { AnanasClient } from "@/lib/ananas/client";
import { ananasError } from "@/lib/ananas/sync";
export const dynamic = "force-dynamic";
export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  await requireAdminAction(["OPS"]);
  const { id } = await context.params;
  const document = await db.ananasDocument.findUnique({ where: { id } });
  const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
  if (!document) return NextResponse.json({ error: "Dokument nije pronađen." }, { status: 404, headers });
  try {
    const url = await new AnanasClient().pdf(document.kind, document.suborderNumber, document.externalId);
    return new NextResponse(null, { status: 302, headers: { ...headers, Location: url } });
  } catch (error) { return NextResponse.json({ error: ananasError(error) }, { status: 502, headers }); }
}
