import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { addressSchema, createAddress, listAddresses } from "@/lib/api/addresses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireUser();
  return NextResponse.json({ items: await listAddresses(user.id) });
}

export async function POST(req: Request) {
  const user = await requireUser();
  const body = await req.json().catch(() => null);
  const parsed = addressSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.flatten() }, { status: 400 });
  }
  const created = await createAddress(user.id, parsed.data);
  return NextResponse.json({ item: created }, { status: 201 });
}
