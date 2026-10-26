import "server-only";
import webpush from "web-push";
import { db } from "@/lib/db";
import { enqueueBackgroundJob, processBackgroundJob } from "@/lib/background-jobs";
import { isPushEndpoint } from "./push-policy";
import { canAccessAdminModule } from "./access-policy";

function configured(value: string | undefined) {
  return value?.trim() && !value.trim().startsWith("GET_FROM_") ? value.trim() : null;
}

export function getPushConfiguration() {
  const publicKey = configured(process.env.VAPID_PUBLIC_KEY);
  const privateKey = configured(process.env.VAPID_PRIVATE_KEY);
  const subject = configured(process.env.VAPID_SUBJECT);
  if (!publicKey || !privateKey || !subject) return null;
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    return { publicKey, privateKey, subject };
  } catch { return null; }
}

function pushStatus(error: unknown) {
  return error && typeof error === "object" && "statusCode" in error ? Number(error.statusCode) : null;
}

export async function sendAdminDevicePush(subscriptionId: string, payload: {
  title: string; body: string; url: string; tag: string;
}) {
  const subscription = await db.adminPushSubscription.findUnique({
    where: { id: subscriptionId }, include: { adminUser: { select: { enabled: true, role: true, accessPolicy: true } } },
  });
  const accessModule = payload.url === "/admin/erp/posete-konverzije" ? "/admin/erp/posete-konverzije" : "/admin/erp/prodajni-nalozi";
  if (!subscription || !subscription.adminUser.enabled || !canAccessAdminModule(subscription.adminUser, accessModule, ["OPS"])) return false;
  const config = getPushConfiguration();
  if (!config) throw new Error("Admin push is not configured");
  if (!isPushEndpoint(subscription.endpoint)) throw new Error("Invalid push endpoint");
  try {
    await webpush.sendNotification({
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    }, JSON.stringify(payload), {
      vapidDetails: config, timeout: 10_000, TTL: 3600, urgency: "high",
    });
    return true;
  } catch (error) {
    const status = pushStatus(error);
    if (status === 404 || status === 410) {
      await db.adminPushSubscription.deleteMany({ where: { id: subscription.id } });
      return false;
    }
    // Provider errors can contain the private endpoint. Keep retry logs anonymous.
    throw new Error(`Push delivery failed (${status ?? "network"})`);
  }
}

export async function fanOutOrderPush(orderId: string) {
  const order = await db.order.findUnique({ where: { id: orderId }, select: { createdAt: true } });
  if (!order || Date.now() - order.createdAt.getTime() > 3600_000) return;
  const subscriptions = await db.adminPushSubscription.findMany({
    where: { createdAt: { lte: order.createdAt }, adminUser: { enabled: true } },
    select: { id: true, adminUserId: true, adminUser: { select: { role: true, accessPolicy: true } } },
  });
  const jobs = [];
  for (const subscription of subscriptions) {
    if (!canAccessAdminModule(subscription.adminUser, "/admin/erp/prodajni-nalozi", ["OPS"])) continue;
    jobs.push(await enqueueBackgroundJob({
      kind: "ADMIN_ORDER_PUSH_DEVICE", payload: { orderId, subscriptionId: subscription.id, adminUserId: subscription.adminUserId },
      idempotencyKey: `admin-order-push:${orderId}:${subscription.id}`,
    }));
  }
  await Promise.allSettled(jobs.map(job => processBackgroundJob(job.id)));
}

export async function deliverOrderPush(orderId: string, subscriptionId: string, adminUserId: string) {
  const [order, subscription] = await Promise.all([
    db.order.findUnique({ where: { id: orderId }, select: { number: true, createdAt: true, total: true } }),
    db.adminPushSubscription.findUnique({ where: { id: subscriptionId }, select: { adminUserId: true } }),
  ]);
  if (!order || !subscription || subscription.adminUserId !== adminUserId || Date.now() - order.createdAt.getTime() > 3600_000) return;
  await sendAdminDevicePush(subscriptionId, {
    title: `Nova porudžbina ${order.number}`,
    body: `Ukupno: ${new Intl.NumberFormat("sr-Latn-RS", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(order.total))} din. Otvorite porudžbinu za pregled.`,
    url: `/admin/erp/prodajni-nalozi/${encodeURIComponent(orderId)}`,
    tag: `order-${orderId}`,
  });
}
