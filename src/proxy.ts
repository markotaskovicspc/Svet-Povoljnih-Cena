import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Edge proxy only propagates the resolved pathname to layouts.
 * Auth is handled in server components / route handlers so public pages do not
 * invoke Auth.js on every request.
 */

export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", pathname);

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  // Match every route so we can attach `x-pathname` for layouts; auth gating
  // logic is path-prefixed inside the handler above.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
