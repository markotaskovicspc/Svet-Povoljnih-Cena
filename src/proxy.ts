import { NextResponse } from "next/server";
import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth/auth.config";

/**
 * Edge middleware — gates `/admin` and `/nalog` route trees.
 *
 * Uses the Edge-safe `authConfig` (no Prisma / bcrypt) so the middleware
 * bundle stays under the Edge runtime constraints. The Node-only providers
 * live in `@/lib/auth/auth` which is loaded by route handlers / server
 * components only.
 */

const ADMIN_PREFIX = "/admin";
const ACCOUNT_PREFIX = "/nalog";
const ADMIN_LOGIN = "/admin/prijava";
const ACCOUNT_LOGIN = "/nalog/prijava";

const PUBLIC_ACCOUNT_PATHS = new Set<string>([
  "/nalog/prijava",
  "/nalog/registracija",
  "/nalog/zaboravljena-lozinka",
  "/nalog/resetuj-lozinku",
]);

const PUBLIC_ADMIN_PATHS = new Set<string>([ADMIN_LOGIN]);

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { pathname, search } = req.nextUrl;
  const user = req.auth?.user;

  if (pathname.startsWith(ADMIN_PREFIX)) {
    if (PUBLIC_ADMIN_PATHS.has(pathname)) return NextResponse.next();
    if (!user || user.userType !== "admin") {
      const url = req.nextUrl.clone();
      url.pathname = ADMIN_LOGIN;
      url.searchParams.set("callbackUrl", `${pathname}${search}`);
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  if (pathname.startsWith(ACCOUNT_PREFIX)) {
    if (PUBLIC_ACCOUNT_PATHS.has(pathname)) return NextResponse.next();
    if (!user || user.userType !== "customer") {
      const url = req.nextUrl.clone();
      url.pathname = ACCOUNT_LOGIN;
      url.searchParams.set("callbackUrl", `${pathname}${search}`);
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/admin/:path*", "/nalog/:path*"],
};
