import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { withAdmin, requireAdminAction } from "@/lib/admin";
import { PageHeader } from "@/components/admin/page-header";
import { Card } from "@/components/admin/card";
import { DataTable } from "@/components/admin/data-table";
import { SubmitButton } from "@/components/admin/submit-button";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Newsletter pretplatnici",
  robots: { index: false, follow: false },
};

async function unsubscribe(formData: FormData) {
  "use server";

  return withAdmin(
    { allowed: ["ADS", "OPS"], action: "newsletter.unsubscribe", entity: "NewsletterSubscriber" },
    async (_a, formData: FormData) => {
        const id = String(formData.get("id") ?? "");
        if (!id) return { ok: false as const, error: "Nedostaje ID." };
        await db.newsletterSubscriber.update({
          where: { id },
          data: { unsubscribedAt: new Date(), consent: false },
        });
        revalidatePath("/admin/newsletter");
        return { ok: true as const, entityId: id };
      },
  )(formData);
}

async function removeSub(formData: FormData) {
  "use server";

  return withAdmin(
    { allowed: ["ADS", "OPS"], action: "newsletter.delete", entity: "NewsletterSubscriber" },
    async (_a, formData: FormData) => {
        const id = String(formData.get("id") ?? "");
        if (!id) return { ok: false as const, error: "Nedostaje ID." };
        await db.newsletterSubscriber.delete({ where: { id } });
        revalidatePath("/admin/newsletter");
        return { ok: true as const, entityId: id };
      },
  )(formData);
}

export default async function NewsletterPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireAdminAction(["ADS", "OPS"]);
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const subs = await db.newsletterSubscriber.findMany({
    where: q
      ? { email: { contains: q, mode: "insensitive" } }
      : {},
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  const active = subs.filter((s) => s.consent && !s.unsubscribedAt).length;

  return (
    <>
      <PageHeader
        title="Newsletter"
        description={`${active.toLocaleString("sr-Latn-RS")} aktivnih · ${subs.length} prikazano`}
        crumbs={[{ href: "/admin", label: "Admin" }, { label: "Newsletter" }]}
      />
      <div className="space-y-4 px-8 py-6">
        <Card>
          <form className="flex items-end gap-3" method="get">
            <div className="flex-1">
              <label className="text-xs font-medium uppercase tracking-[0.12em] text-ink-500">
                Pretraga email-a
              </label>
              <input
                name="q"
                defaultValue={q}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
              />
            </div>
            <button
              type="submit"
              className="h-8 rounded-lg bg-walnut px-4 text-sm font-medium text-white hover:bg-walnut/90"
            >
              Filtriraj
            </button>
          </form>
        </Card>

        <Card>
          <DataTable
            columns={[
              { key: "email", label: "Email" },
              { key: "source", label: "Izvor" },
              { key: "created", label: "Prijavljen" },
              { key: "status", label: "Status" },
              { key: "actions", label: "" },
            ]}
            rows={subs.map((s) => ({
              id: s.id,
              cells: {
                email: <span className="font-mono text-xs">{s.email}</span>,
                source: s.source ?? "—",
                created: s.createdAt.toLocaleDateString("sr-Latn-RS"),
                status: s.unsubscribedAt
                  ? <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] text-destructive">Odjavljen</span>
                  : s.consent
                    ? <span className="rounded-full bg-success/15 px-2 py-0.5 text-[11px] text-success">Aktivan</span>
                    : <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] text-warning">Bez pristanka</span>,
                actions: (
                  <div className="flex gap-2">
                    {!s.unsubscribedAt ? (
                      <form action={unsubscribe}>
                        <input type="hidden" name="id" value={s.id} />
                        <SubmitButton size="sm" variant="outline">Odjavi</SubmitButton>
                      </form>
                    ) : null}
                    <form action={removeSub}>
                      <input type="hidden" name="id" value={s.id} />
                      <SubmitButton
                        size="sm"
                        variant="ghost"
                        confirm={`Obrisati pretplatnika ${s.email}? Ova akcija je nepovratna.`}
                      >
                        Obriši
                      </SubmitButton>
                    </form>
                  </div>
                ),
              },
            }))}
            empty="Nema pretplatnika."
          />
        </Card>
      </div>
    </>
  );
}
