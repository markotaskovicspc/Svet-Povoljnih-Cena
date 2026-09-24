import { NextResponse } from "next/server";
import { confirmLoyalty, LOYALTY_COOKIE, LOYALTY_SESSION_SECONDS } from "@/lib/loyalty/service.server";
import { getEmailConfig } from "@/lib/email/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const destination = new URL("/loyalty/potvrda", getEmailConfig().baseUrl);
  try {
    const session = await confirmLoyalty(new URL(req.url).searchParams.get("token") ?? "");
    destination.searchParams.set("loyalty", session ? "confirmed" : "invalid");
    const response = NextResponse.redirect(destination);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    if (session) response.cookies.set(LOYALTY_COOKIE, session, {
      httpOnly: true, secure: destination.protocol === "https:", sameSite: "lax",
      path: "/", maxAge: LOYALTY_SESSION_SECONDS,
    });
    return response;
  } catch {
    destination.searchParams.set("loyalty", "error");
    return NextResponse.redirect(destination);
  }
}
