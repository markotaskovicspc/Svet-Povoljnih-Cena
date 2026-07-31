import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * The admin shell needs the resolved pathname for login bypass and safe
 * callback URLs. Public storefront routes intentionally skip this proxy so
 * their cache keys and CDN responses remain request-independent.
 */

export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", pathname);

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/admin/:path*"],
};
