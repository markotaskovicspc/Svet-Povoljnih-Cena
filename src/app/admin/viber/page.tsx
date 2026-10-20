import { db } from "@/lib/db";
import { requireAdminAction } from "@/lib/admin";
import { envValue } from "@/lib/env";
import { isViberReady } from "@/lib/viber/config";
import { getViberContactSummary } from "@/lib/viber/audience";
import { audienceDescription } from "@/lib/viber/ui";
import { ViberDashboard, type ViberCampaignView } from "@/components/admin/viber/dashboard";
import { previewAudience, saveViberDraft, launchViberCampaign, testViberMessage, deleteViberDraft } from "./actions";
export const dynamic = "force-dynamic";
export const metadata = { title: "Viber poruke", robots: { index: false, follow: false } };
export default async function ViberPage({ searchParams }: { searchParams: Promise<{ campaign?: string }> }) {
  await requireAdminAction(["ADS"]);
  const params = await searchParams;
  // eslint-disable-next-line react-hooks/purity -- Request-time window for this dynamic authenticated server page.
  const since = new Date(Date.now() - 30 * 86400_000);
  const where = { kind: "NTH_VIBER_OUTBOUND", createdAt: { gte: since } };
  const [audiences, campaigns, reports, groups, contactSummary] = await Promise.all([
    db.viberAudienceQuery.findMany({ orderBy: { name: "asc" } }),
    db.viberCampaign.findMany({ orderBy: { createdAt: "desc" }, include: { audience: { select: { name: true } } }, take: 200 }),
    db.backgroundJob.findMany({ where, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, status: true, payload: true, createdAt: true } }),
    db.backgroundJob.groupBy({ by: ["status"], where, _count: { _all: true } }),
    getViberContactSummary(),
  ]);
  const rows: ViberCampaignView[] = campaigns.map(c => ({ id: c.id, title: c.title, body: c.body, audienceId: c.audienceId, audienceName: c.audience.name, imageUrl: c.imageUrl, ctaLabel: c.ctaLabel, ctaUrl: c.ctaUrl, status: c.status, scheduledAt: c.scheduledAt?.toISOString() ?? null, recipients: c.recipients, accepted: c.delivered, failed: c.failed }));
  const counts = Object.fromEntries(groups.map(g => [g.status, g._count._all]));
  return <ViberDashboard contactSummary={contactSummary}
    audiences={audiences.map(a => ({ id: a.id, name: a.name, description: audienceDescription(a.filter) }))}
    campaigns={rows} initialCampaign={rows.find(c => c.id===params.campaign && ["DRAFT","SCHEDULED"].includes(c.status))}
    reports={reports.map(r => {
      const data = r.payload as { destinations?: { phoneNumber?: string }[]; viber?: { text?: string; template?: { parameters?: { order_number?: string } } } };
      return { id: r.id, status: r.status, time: r.createdAt.toISOString(), recipient: `••• ${String(data.destinations?.[0]?.phoneNumber ?? "").slice(-4)}`, description: data.viber?.text?.slice(0,120) ?? (data.viber?.template?.parameters?.order_number ? `Porudžbina ${data.viber.template.parameters.order_number}` : "Automatska poruka") };
    })}
    metrics={{ queued: (counts.VIBER_QUEUED ?? 0)+(counts.VIBER_RUNNING ?? 0), accepted: counts.VIBER_SENT ?? 0, delivered: counts.VIBER_DELIVERED ?? 0, seen: counts.VIBER_SEEN ?? 0, failed: counts.VIBER_FAILED ?? 0, unknown: counts.VIBER_UNKNOWN ?? 0 }}
    ready={isViberReady()} scheduledEnabled={envValue("VIBER_SCHEDULED_CAMPAIGNS_ENABLED")==="true"} ordersEnabled={envValue("VIBER_ORDER_NOTIFICATIONS_ENABLED")==="true"}
    confirmationConfigured={Boolean(envValue("NTH_ORDER_CONFIRMATION_TEMPLATE_ID"))} statusConfigured={Boolean(envValue("NTH_ORDER_STATUS_TEMPLATE_ID"))}
    previewAudience={previewAudience} saveDraft={saveViberDraft} launch={launchViberCampaign} testMessage={testViberMessage} deleteDraft={deleteViberDraft}
  />;
}
