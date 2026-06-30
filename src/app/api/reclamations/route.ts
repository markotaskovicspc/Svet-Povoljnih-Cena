import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import {
  createReclamation,
  createReclamationSchema,
  listReclamationsForUser,
} from "@/lib/api/reclamations";
import {
  checkRateLimitForRequest,
  rateLimitJson,
  RATE_LIMITS,
} from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.userType !== "customer") {
    return NextResponse.json({ items: [] });
  }
  return NextResponse.json({ items: await listReclamationsForUser(user.id) });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = createReclamationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const limited = checkRateLimitForRequest(
    req,
    "reclamation:create",
    RATE_LIMITS.reclamation,
    [parsed.data.orderNumberOrFiscal],
  );
  if (!limited.ok) {
    return rateLimitJson(limited);
  }
  const user = await getCurrentUser();
  const userId = user?.userType === "customer" ? user.id : null;
  const result = await createReclamation(parsed.data, userId);
  if (!result.ok) {
    return NextResponse.json(result, {
      status:
        result.reason === "ORDER_NOT_FOUND"
          ? 404
          : result.reason === "UNAUTHORIZED"
            ? 403
            : 422,
    });
  }
  return NextResponse.json(result, { status: 201 });
}
