import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentAdmin } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { canReceiveOrderPush, pushEndpointSchema, pushSubscriptionSchema } from "@/lib/admin/push-policy";
import { getPushConfiguration, sendAdminDevicePush } from "@/lib/admin/order-push.server";
import { checkRateLimit, rateLimitJson } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const response = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });

export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin || !canReceiveOrderPush(admin.role)) return response({ error: "Nemate pristup." }, 403);
  const config = getPushConfiguration();
  return response({ configured: Boolean(config), publicKey: config?.publicKey ?? null });
}

const commandSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("subscribe"), subscription: pushSubscriptionSchema }),
  z.object({ operation: z.literal("status"), endpoint: pushEndpointSchema }),
  z.object({ operation: z.literal("unsubscribe"), endpoint: pushEndpointSchema }),
  z.object({ operation: z.literal("test"), endpoint: pushEndpointSchema }),
  z.object({ operation: z.literal("preferences"), endpoint: pushEndpointSchema, trafficAlerts: z.boolean() }),
]);

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return response({ error: "Neispravan zahtev." }, 403);
  const admin = await getCurrentAdmin();
  if (!admin || !canReceiveOrderPush(admin.role)) return response({ error: "Nemate pristup." }, 403);
  const command = commandSchema.safeParse(await request.json().catch(() => null));
  if (!command.success) return response({ error: "Neispravno obaveštenje." }, 400);
  const data = command.data;
  if (data.operation === "unsubscribe") {
    await db.adminPushSubscription.deleteMany({ where: { endpoint: data.endpoint, adminUserId: admin.id } });
    return response({ ok: true });
  }
  if (data.operation === "status") {
    const subscription = await db.adminPushSubscription.findFirst({ where: { endpoint: data.endpoint, adminUserId: admin.id }, select: { id: true, trafficAlerts: true } });
    return response({ subscribed: Boolean(subscription), trafficAlerts: subscription?.trafficAlerts ?? false });
  }
  if (data.operation === "preferences") {
    const result = await db.adminPushSubscription.updateMany({ where: { endpoint: data.endpoint, adminUserId: admin.id }, data: { trafficAlerts: data.trafficAlerts } });
    return result.count ? response({ ok: true }) : response({ error: "Prvo uključite obaveštenja na ovom uređaju." }, 404);
  }
  const limited = await checkRateLimit(`admin-push:${admin.id}`, { limit: 20, windowMs: 60_000 });
  if (!limited.ok) return rateLimitJson(limited);
  if (!getPushConfiguration()) return response({ error: "Obaveštenja još nisu podešena na serveru." }, 503);
  if (data.operation === "subscribe") {
    await db.adminPushSubscription.upsert({
      where: { endpoint: data.subscription.endpoint },
      create: { adminUserId: admin.id, endpoint: data.subscription.endpoint, ...data.subscription.keys },
      update: { adminUserId: admin.id, ...data.subscription.keys, createdAt: new Date() },
    });
    return response({ ok: true });
  }
  const subscription = await db.adminPushSubscription.findFirst({ where: { endpoint: data.endpoint, adminUserId: admin.id }, select: { id: true } });
  if (!subscription) return response({ error: "Prvo uključite obaveštenja na ovom uređaju." }, 404);
  try {
    const sent = await sendAdminDevicePush(subscription.id, {
      title: "Obaveštenja su uključena", body: "Ovde ćete primati obaveštenja o novim porudžbinama.",
      url: "/admin/erp/prodajni-nalozi", tag: "admin-push-test",
    });
    return sent ? response({ ok: true }) : response({ error: "Dozvola je istekla. Ponovo uključite obaveštenja." }, 410);
  } catch {
    return response({ error: "Probno obaveštenje nije poslato. Pokušajte ponovo." }, 502);
  }
}
