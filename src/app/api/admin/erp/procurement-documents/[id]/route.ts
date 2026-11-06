import { NextResponse } from "next/server";
import { requireAdminAction } from "@/lib/admin";
import { db } from "@/lib/db";
import { createAdminClient } from "@/lib/supabase/admin";
import { getErpDocumentsBucket } from "@/lib/supabase/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function encodeFilename(value: string) {
  return encodeURIComponent(value).replace(/['()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function asciiFilename(value: string) {
  return value
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_")
    .slice(0, 150) || "document";
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  await requireAdminAction(["OPS"]);
  const { id } = await context.params;
  const document = await db.procurementDocument.findUnique({
    where: { id },
    select: {
      storageKey: true,
      originalFilename: true,
      mimeType: true,
      sizeBytes: true,
    },
  });
  if (!document) {
    return NextResponse.json({ error: "Dokument nije pronađen." }, { status: 404 });
  }
  const { data, error } = await createAdminClient()
    .storage.from(getErpDocumentsBucket())
    .download(document.storageKey);
  if (error || !data) {
    return NextResponse.json(
      { error: "Dokument nije dostupan u skladištu." },
      { status: 502, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  if (data.size !== document.sizeBytes) {
    return NextResponse.json(
      { error: "Veličina dokumenta se ne poklapa sa evidencijom." },
      { status: 502, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const disposition = new URL(request.url).searchParams.get("download") === "1"
    ? "attachment"
    : "inline";
  return new Response(data, {
    headers: {
      "Content-Type": document.mimeType,
      "Content-Length": String(document.sizeBytes),
      "Content-Disposition": `${disposition}; filename="${asciiFilename(document.originalFilename)}"; filename*=UTF-8''${encodeFilename(document.originalFilename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
