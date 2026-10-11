import { requireAdminAction } from "@/lib/admin";
import { db } from "@/lib/db";
import { readInvoiceXml } from "@/lib/sef/ubl";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAdminAction(["OPS"]);
  const doc = await db.sefDocument.findUnique({ where: { id: (await params).id } });
  if (!doc) return new Response("Dokument ne postoji.", { status: 404 });
  const index = new URL(request.url).searchParams.get("attachment");
  let bytes: Uint8Array, filename: string, contentType: string;
  if (index !== null) {
    if (!/^\d+$/.test(index)) return new Response("Neispravan prilog.", { status: 400 });
    const attachment = readInvoiceXml(doc.xml).attachments[Number(index)];
    if (!attachment) return new Response("Prilog ne postoji.", { status: 404 });
    bytes = Buffer.from(attachment.base64, "base64"); filename = attachment.filename; contentType = "application/octet-stream";
  } else { bytes = Buffer.from(doc.xml); filename = `sef-${doc.number.replace(/[^a-zA-Z0-9._-]/g, "_")}.xml`; contentType = "application/xml"; }
  return new Response(bytes as BodyInit, { headers: { "Content-Type": contentType, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
