import { NextResponse } from "next/server";
import { requireAdminAction } from "@/lib/admin";
import { lookupOrderForReclamation } from "@/lib/api/reclamations";
import { createReclamationLinkToken } from "@/lib/api/reclamation-link-token";

export async function POST(request: Request) {
  await requireAdminAction(["OPS"]);
  const body = await request.json().catch(() => null);
  const number = typeof body?.orderNumberOrFiscal === "string" ? body.orderNumberOrFiscal.trim() : "";
  if (number.length < 3 || number.length > 80) return NextResponse.json({ message: "Unesite broj porudžbine ili fiskalnog računa." }, { status: 400 });
  const order = await lookupOrderForReclamation(number);
  if (!order) return NextResponse.json({ message: "Porudžbina nije pronađena. Unesite ceo broj ili izaberite predlog." }, { status: 404 });
  if (order.status !== "ISPORUCENO") return NextResponse.json({ message: "Link za kupca možete napraviti za isporučenu porudžbinu. Ako je roba već isporučena, prvo proverite status porudžbine." }, { status: 422 });
  const { token, expiresAt } = createReclamationLinkToken(order.number);
  const params = new URLSearchParams({ order: order.number, token });
  return NextResponse.json({ path: `/reklamacije/prijava?${params}`, orderNumber: order.number, expiresAt }, { headers: { "Cache-Control": "no-store" } });
}
