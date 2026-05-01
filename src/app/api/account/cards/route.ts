import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { listSavedCards } from "@/lib/api/cards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireUser();
  return NextResponse.json({ items: await listSavedCards(user.id) });
}
