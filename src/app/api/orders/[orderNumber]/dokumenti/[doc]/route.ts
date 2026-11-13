import { NextResponse } from "next/server";
import {
  buildCustomerDocument,
  verifyOrderDocumentsToken,
  type CustomerDocumentKind,
} from "@/lib/orders/customer-documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: CustomerDocumentKind[] = ["odustanak", "garancija", "fiskalni"];

/** PDF download for the customer documents page (linked from Viber). */
export async function GET(
  request: Request,
  context: { params: Promise<{ orderNumber: string; doc: string }> },
) {
  const { orderNumber, doc } = await context.params;
  const url = new URL(request.url);
  const token = url.searchParams.get("t");
  if (!verifyOrderDocumentsToken(orderNumber, token)) {
    return NextResponse.json({ ok: false, message: "Link nije važeći." }, { status: 403 });
  }
  if (!KINDS.includes(doc as CustomerDocumentKind)) {
    return NextResponse.json({ ok: false, message: "Nepoznat dokument." }, { status: 404 });
  }
  const index = Math.max(0, Number.parseInt(url.searchParams.get("i") ?? "0", 10) || 0);
  const file = await buildCustomerDocument(orderNumber, doc as CustomerDocumentKind, index);
  if (!file) {
    return NextResponse.json({ ok: false, message: "Dokument nije dostupan." }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(file.content), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${file.filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
    },
  });
}
