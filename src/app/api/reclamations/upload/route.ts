import { NextResponse } from "next/server";
import { presignSchema, presignUpload } from "@/lib/api/uploads";
import { canAccessOrder, readOrderAccessToken } from "@/lib/api/order-access";
import { lookupOrderForReclamation } from "@/lib/api/reclamations";
import {
  checkRateLimitForRequest,
  rateLimitJson,
  RATE_LIMITS,
} from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = presignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.flatten() }, { status: 400 });
  }
  const limited = checkRateLimitForRequest(
    req,
    "reclamation:upload",
    RATE_LIMITS.upload,
    [parsed.data.orderNumberOrFiscal, parsed.data.sku],
  );
  if (!limited.ok) {
    return rateLimitJson(limited);
  }
  try {
    const order = await lookupOrderForReclamation(parsed.data.orderNumberOrFiscal);
    if (!order) {
      return NextResponse.json({ error: "unknown_order" }, { status: 404 });
    }
    const item = order.items.find((i) => i.sku === parsed.data.sku);
    if (!item) {
      return NextResponse.json({ error: "unknown_item" }, { status: 422 });
    }
    if (
      !(await canAccessOrder({
        order,
        token: parsed.data.accessToken ?? readOrderAccessToken(req),
      }))
    ) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return NextResponse.json(
      await presignUpload(parsed.data, {
        orderNumber: order.number,
        sku: item.sku,
      }),
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: "upload_unavailable",
        message: err instanceof Error ? err.message : "Upload trenutno nije dostupan.",
      },
      { status: 503 },
    );
  }
}
