import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { CampaignStatus, Prisma } from "@prisma/client";
import { withAdmin, requireAdminAction } from "@/lib/admin";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardTitle } from "@/components/admin/card";
import { Field } from "@/components/admin/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DataTable } from "@/components/admin/data-table";
import { SubmitButton } from "@/components/admin/submit-button";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Viber kampanje",
  robots: { index: false, follow: false },
};

const dt = (d: Date | null | undefined) =>
  d ? new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : "";

const saveAudience = withAdmin(
  { allowed: ["ADS"], action: "viber.audienceSave", entity: "ViberAudienceQuery" },
  async (_a, formData: FormData) => {
    const id = String(formData.get("id") ?? "") || null;
    const name = String(formData.get("name") ?? "").trim();
    const filterRaw = String(formData.get("filter") ?? "{}").trim();
    if (!name) return { ok: false as const, error: "Naziv je obavezan." };
    let filter: unknown;
    try {
      filter = JSON.parse(filterRaw);
    } catch {
      return { ok: false as const, error: "Filter mora biti validan JSON." };
    }
    const data = { name, filter: filter as Prisma.InputJsonValue };
    const res = id
      ? await db.viberAudienceQuery.update({ where: { id }, data })
      : await db.viberAudienceQuery.create({ data });
    revalidatePath("/admin/viber");
    return { ok: true as const, entityId: res.id, diff: { name } };
  },
);

const deleteAudience = withAdmin(
  { allowed: ["ADS"], action: "viber.audienceDelete", entity: "ViberAudienceQuery" },
  async (_a, formData: FormData) => {
    const id = String(formData.get("id") ?? "");
    if (!id) return { ok: false as const, error: "Nedostaje ID." };
    await db.viberAudienceQuery.delete({ where: { id } });
    revalidatePath("/admin/viber");
    return { ok: true as const, entityId: id };
  },
);

const saveCampaign = withAdmin(
  { allowed: ["ADS"], action: "viber.campaignSave", entity: "ViberCampaign" },
  async (_a, formData: FormData) => {
    const id = String(formData.get("id") ?? "") || null;
    const audienceId = String(formData.get("audienceId") ?? "");
    const title = String(formData.get("title") ?? "").trim();
    const body = String(formData.get("body") ?? "").trim();
    const imageUrl = String(formData.get("imageUrl") ?? "").trim() || null;
    const ctaLabel = String(formData.get("ctaLabel") ?? "").trim() || null;
    const ctaUrl = String(formData.get("ctaUrl") ?? "").trim() || null;
    const status = String(formData.get("status") ?? "DRAFT") as CampaignStatus;
    const scheduledRaw = String(formData.get("scheduledAt") ?? "").trim();
    const scheduledAt = scheduledRaw ? new Date(scheduledRaw) : null;
    if (!audienceId || !title || !body) {
      return { ok: false as const, error: "Audience, naslov i tekst su obavezni." };
    }
    const data = {
      audienceId,
      title,
      body,
      imageUrl,
      ctaLabel,
      ctaUrl,
      status,
      scheduledAt,
    };
    const res = id
      ? await db.viberCampaign.update({ where: { id }, data })
      : await db.viberCampaign.create({ data });
    revalidatePath("/admin/viber");
    return { ok: true as const, entityId: res.id, diff: { title, status } };
  },
);

const deleteCampaign = withAdmin(
  { allowed: ["ADS"], action: "viber.campaignDelete", entity: "ViberCampaign" },
  async (_a, formData: FormData) => {
    const id = String(formData.get("id") ?? "");
    if (!id) return { ok: false as const, error: "Nedostaje ID." };
    await db.viberCampaign.delete({ where: { id } });
    revalidatePath("/admin/viber");
    return { ok: true as const, entityId: id };
  },
);

export default async function ViberPage({
  searchParams,
}: {
  searchParams: Promise<{ campaign?: string; audience?: string }>;
}) {
  await requireAdminAction(["ADS"]);
  const sp = await searchParams;
  const [audiences, campaigns, editAudience, editCampaign] = await Promise.all([
    db.viberAudienceQuery.findMany({ orderBy: { name: "asc" } }),
    db.viberCampaign.findMany({
      orderBy: { createdAt: "desc" },
      include: { audience: { select: { name: true } } },
    }),
    sp.audience
      ? db.viberAudienceQuery.findUnique({ where: { id: sp.audience } })
      : Promise.resolve(null),
    sp.campaign
      ? db.viberCampaign.findUnique({ where: { id: sp.campaign } })
      : Promise.resolve(null),
  ]);

  return (
    <>
      <PageHeader
        title="Viber kampanje"
        description={`${audiences.length} audijencija · ${campaigns.length} kampanja`}
        crumbs={[{ href: "/admin", label: "Admin" }, { label: "Viber" }]}
      />
      <div className="grid grid-cols-1 gap-6 px-8 py-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card>
            <CardTitle>Audijencije</CardTitle>
            <DataTable
              columns={[
                { key: "name", label: "Naziv" },
                { key: "filter", label: "Filter" },
                { key: "campaigns", label: "Kampanje", align: "right" },
                { key: "actions", label: "" },
              ]}
              rows={audiences.map((a) => ({
                id: a.id,
                cells: {
                  name: a.name,
                  filter: <code className="text-xs text-ink-500">{JSON.stringify(a.filter).slice(0, 80)}</code>,
                  campaigns: campaigns.filter((c) => c.audienceId === a.id).length,
                  actions: (
                    <div className="flex gap-2">
                      <a
                        href={`?audience=${a.id}`}
                        className="text-xs text-walnut hover:underline"
                      >
                        Izmeni
                      </a>
                      <form action={deleteAudience}>
                        <input type="hidden" name="id" value={a.id} />
                        <SubmitButton size="sm" variant="ghost">Obriši</SubmitButton>
                      </form>
                    </div>
                  ),
                },
              }))}
              empty="Nema audijencija."
            />
          </Card>

          <Card>
            <CardTitle>Kampanje</CardTitle>
            <DataTable
              columns={[
                { key: "title", label: "Naslov" },
                { key: "audience", label: "Audijencija" },
                { key: "status", label: "Status" },
                { key: "scheduledAt", label: "Zakazano" },
                { key: "stats", label: "Stats" },
                { key: "actions", label: "" },
              ]}
              rows={campaigns.map((c) => ({
                id: c.id,
                cells: {
                  title: c.title,
                  audience: c.audience.name,
                  status: <span className="rounded-full bg-muted-bg px-2 py-0.5 text-[11px]">{c.status}</span>,
                  scheduledAt: c.scheduledAt?.toLocaleString("sr-Latn-RS") ?? "—",
                  stats: c.recipients
                    ? `${c.delivered ?? 0}/${c.recipients}`
                    : "—",
                  actions: (
                    <div className="flex gap-2">
                      <a href={`?campaign=${c.id}`} className="text-xs text-walnut hover:underline">
                        Izmeni
                      </a>
                      <form action={deleteCampaign}>
                        <input type="hidden" name="id" value={c.id} />
                        <SubmitButton size="sm" variant="ghost">Obriši</SubmitButton>
                      </form>
                    </div>
                  ),
                },
              }))}
              empty="Nema kampanja."
            />
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardTitle>{editAudience ? "Izmena audijencije" : "Nova audijencija"}</CardTitle>
            <form action={saveAudience} className="space-y-3">
              <input type="hidden" name="id" value={editAudience?.id ?? ""} />
              <Field label="Naziv">
                <Input name="name" defaultValue={editAudience?.name ?? ""} required />
              </Field>
              <Field label="Filter (JSON)">
                <Textarea
                  name="filter"
                  rows={5}
                  defaultValue={JSON.stringify(editAudience?.filter ?? {}, null, 2)}
                  className="font-mono text-xs"
                />
              </Field>
              <div className="flex justify-end">
                <SubmitButton size="sm">{editAudience ? "Sačuvaj" : "Kreiraj"}</SubmitButton>
              </div>
            </form>
          </Card>

          <Card>
            <CardTitle>{editCampaign ? "Izmena kampanje" : "Nova kampanja"}</CardTitle>
            <form action={saveCampaign} className="space-y-3">
              <input type="hidden" name="id" value={editCampaign?.id ?? ""} />
              <Field label="Audijencija">
                <select
                  name="audienceId"
                  defaultValue={editCampaign?.audienceId ?? ""}
                  required
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                >
                  <option value="">— odaberi —</option>
                  {audiences.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Naslov">
                <Input name="title" defaultValue={editCampaign?.title ?? ""} required />
              </Field>
              <Field label="Tekst">
                <Textarea name="body" rows={4} defaultValue={editCampaign?.body ?? ""} required />
              </Field>
              <Field label="Image URL">
                <Input name="imageUrl" defaultValue={editCampaign?.imageUrl ?? ""} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="CTA labela">
                  <Input name="ctaLabel" defaultValue={editCampaign?.ctaLabel ?? ""} />
                </Field>
                <Field label="CTA URL">
                  <Input name="ctaUrl" defaultValue={editCampaign?.ctaUrl ?? ""} />
                </Field>
              </div>
              <Field label="Status">
                <select
                  name="status"
                  defaultValue={editCampaign?.status ?? "DRAFT"}
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                >
                  {Object.values(CampaignStatus).map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </Field>
              <Field label="Zakazano za">
                <Input
                  type="datetime-local"
                  name="scheduledAt"
                  defaultValue={dt(editCampaign?.scheduledAt)}
                />
              </Field>
              <div className="flex justify-end">
                <SubmitButton size="sm">{editCampaign ? "Sačuvaj" : "Kreiraj"}</SubmitButton>
              </div>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}
