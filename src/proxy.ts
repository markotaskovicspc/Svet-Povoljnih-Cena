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

  // Propagate the resolved pathname to RSC layouts (so the root layout can
  // hide storefront chrome on /admin without each route group re-implementing
  // the layout tree).
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", pathname);
  const passthrough = NextResponse.next({ request: { headers: requestHeaders } });

  if (pathname.startsWith(ADMIN_PREFIX)) {
    if (PUBLIC_ADMIN_PATHS.has(pathname)) return passthrough;
    if (!user || user.userType !== "admin") {
      const url = req.nextUrl.clone();
      url.pathname = ADMIN_LOGIN;
      url.searchParams.set("callbackUrl", `${pathname}${search}`);
      return NextResponse.redirect(url);
    }
    return passthrough;
  }

  if (pathname.startsWith(ACCOUNT_PREFIX)) {
    if (PUBLIC_ACCOUNT_PATHS.has(pathname)) return passthrough;
    if (!user || user.userType !== "customer") {
      const url = req.nextUrl.clone();
      url.pathname = ACCOUNT_LOGIN;
      url.searchParams.set("callbackUrl", `${pathname}${search}`);
      return NextResponse.redirect(url);
    }
    return passthrough;
  }

  return passthrough;
});

export const config = {
  // Match every route so we can attach `x-pathname` for layouts; auth gating
  // logic is path-prefixed inside the handler above.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
