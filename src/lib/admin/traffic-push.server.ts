import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { enqueueBackgroundJob, processBackgroundJob } from "@/lib/background-jobs";
import { getPushConfiguration, sendAdminDevicePush } from "./order-push.server";
import { PRESENCE_WINDOW_MS, TRAFFIC_ALERT_THRESHOLD, shouldAlertTraffic } from "@/lib/analytics/presence";

export async function evaluateTrafficAlert(now = new Date()) {
  if (!getPushConfiguration()) return;
  const jobs = await db.$transaction(async tx => {
    // A transaction-scoped, non-blocking lock prevents duplicate fan-out across Vercel instances.
    const [lock] = await tx.$queryRaw<{ acquired: boolean }[]>(Prisma.sql`SELECT pg_try_advisory_xact_lock(782046213) AS acquired`);
    if (!lock?.acquired) return [];
    const previous = await tx.adminSetting.findUnique({ where: { key: "traffic-alert-state" } });
    if (previous && now.getTime() - previous.updatedAt.getTime() < 15_000) return [];
    const state = previous?.value as { lastAlertAt?: string; aboveThreshold?: boolean } | null;
    const parsed = state?.lastAlertAt ? Date.parse(state.lastAlertAt) : NaN;
    const count = await tx.siteVisitorPresence.count({ where: { lastSeenAt: { gte: new Date(now.getTime() - PRESENCE_WINDOW_MS), lte: now } } });
    const alert = shouldAlertTraffic(count, Number.isFinite(parsed) ? parsed : null, now.getTime(), Number.isFinite(parsed) && state?.aboveThreshold === true);
    const subscriptions = alert ? await tx.adminPushSubscription.findMany({
      where: { trafficAlerts: true, adminUser: { enabled: true, role: { in: ["SUPER", "OPS"] } } }, select: { id: true },
    }) : [];
    const lastAlertAt = subscriptions.length ? now.toISOString() : state?.lastAlertAt ?? null;
    const aboveThreshold = count >= TRAFFIC_ALERT_THRESHOLD;
    await tx.adminSetting.upsert({ where: { key: "traffic-alert-state" },
      create: { key: "traffic-alert-state", value: { lastAlertAt, aboveThreshold }, updatedAt: now },
      update: { value: { lastAlertAt, aboveThreshold }, updatedAt: now },
    });
    // Queue inside this transaction: a crash cannot consume the cooldown without a durable notification.
    const jobs = [];
    for (const subscription of subscriptions) jobs.push(await enqueueBackgroundJob({
      kind: "ADMIN_TRAFFIC_PUSH_DEVICE",
      payload: { subscriptionId: subscription.id, count, measuredAt: now.toISOString() },
      idempotencyKey: `traffic-push:${now.getTime()}:${subscription.id}`,
    }, tx));
    return jobs;
  });
  await Promise.allSettled(jobs.map(job => processBackgroundJob(job.id)));
}

export async function deliverTrafficPush(subscriptionId: string, count: number, measuredAt: string) {
  // Do not send a stale crowd alert after a long provider outage or after opt-out.
  if (Date.now() - Date.parse(measuredAt) > 5 * 60_000) return;
  const subscription = await db.adminPushSubscription.findUnique({ where: { id: subscriptionId }, select: { trafficAlerts: true } });
  if (!subscription?.trafficAlerts) return;
  await sendAdminDevicePush(subscriptionId, { title: "20+ posetilaca na sajtu",
    body: `${count} aktivnih posetilaca uz saglasnost za analitiku. Proverite ponašanje sajta.`,
    url: "/admin/erp/posete-konverzije", tag: "site-traffic-20" });
}
