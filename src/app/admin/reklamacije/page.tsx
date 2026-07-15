import Link from "next/link";
import Image from "next/image";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { ReclamationStatus } from "@prisma/client";
import { withAdmin, requireAdminAction } from "@/lib/admin";
import {
  loadReclamationForEmail,
  lowerReclamationStatus,
  sendReclamationStatusChanged,
} from "@/lib/email";
import { signReclamationPhotoUrls } from "@/lib/api/uploads";
import { PageHeader } from "@/components/admin/page-header";
import { Card } from "@/components/admin/card";
import { Field } from "@/components/admin/field";
import { Textarea } from "@/components/ui/textarea";
import { SubmitButton } from "@/components/admin/submit-button";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Reklamacije",
  robots: { index: false, follow: false },
};

async function updateStatus(formData: FormData) {
  "use server";

  return withAdmin(
    { allowed: ["OPS"], action: "reclamation.statusUpdate", entity: "Reclamation" },
    async (actorId, formData: FormData) => {
        const id = String(formData.get("id") ?? "");
        const status = String(formData.get("status") ?? "") as ReclamationStatus;
        const note = String(formData.get("note") ?? "").trim() || null;
        if (!id || !Object.values(ReclamationStatus).includes(status)) {
          return { ok: false as const, error: "Nedostaje ID ili status." };
        }
        const resolved = status === "RESENO" || status === "ODBIJENO";
        await db.$transaction([
          db.reclamation.update({
            where: { id },
            data: { status, resolvedAt: resolved ? new Date() : null },
          }),
          db.reclamationStatusEvent.create({
            data: { reclamationId: id, status, note, actorId },
          }),
        ]);
        void (async () => {
          try {
            const loaded = await loadReclamationForEmail(id);
            if (loaded?.recipient) {
              await sendReclamationStatusChanged({
                reclamation: loaded.reclamation,
                status: lowerReclamationStatus(status),
                to: loaded.recipient,
              });
            }
          } catch (err) {
            console.error("[email] admin reclamation-status failed", err);
          }
        })();
        revalidatePath("/admin/reklamacije");
        return { ok: true as const, entityId: id, diff: { status, note } };
      },
  )(formData);
}

export default async function ReclamationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAdminAction(["OPS"]);
  const sp = await searchParams;
  const status = sp.status as ReclamationStatus | undefined;
  const where = status && Object.values(ReclamationStatus).includes(status)
    ? { status }
    : {};

  const items = await db.reclamation.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      photos: true,
      events: { orderBy: { createdAt: "desc" } },
      order: { select: { number: true } },
    },
  });

  // Photo bucket is private — swap stored canonical URLs for signed ones.
  const signedPhotoUrls = await signReclamationPhotoUrls(
    items.flatMap((r) => r.photos.map((p) => p.url)),
  );

  return (
    <>
      <PageHeader
        title="Reklamacije"
        description={`${items.length} otvorenih · klik na fotografiju otvara puni format`}
        crumbs={[{ href: "/admin", label: "Admin" }, { label: "Reklamacije" }]}
      />
      <div className="px-8 py-6">
        <nav className="mb-4 flex gap-2 text-xs">
          <FilterLink href="/admin/reklamacije" label="Sve" active={!status} />
          {Object.values(ReclamationStatus).map((s) => (
            <FilterLink
              key={s}
              href={`/admin/reklamacije?status=${s}`}
              label={s}
              active={status === s}
            />
          ))}
        </nav>

        <div className="space-y-4">
          {items.length === 0 ? (
            <Card>
              <p className="text-sm text-ink-500">Nema reklamacija.</p>
            </Card>
          ) : (
            items.map((r) => (
              <Card key={r.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-sm">{r.number}</p>
                    <p className="text-xs text-ink-500">
                      Narudžbina{" "}
                      <Link
                        href={`/admin/narudzbine`}
                        className="text-walnut hover:underline"
                      >
                        {r.order.number}
                      </Link>{" "}
                      · SKU {r.sku} · {r.customerFirst} {r.customerLast}
                    </p>
                  </div>
                  <span className="rounded-full bg-muted-bg px-2 py-0.5 text-[11px]">
                    {r.status}
                  </span>
                </div>
                <p className="mt-3 max-w-2xl text-sm text-ink-700">{r.description}</p>
                {r.photos.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {r.photos.map((p) => (
                      <a
                        key={p.id}
                        href={signedPhotoUrls.get(p.url) ?? p.url}
                        target="_blank"
                        rel="noreferrer"
                        className="relative block size-20 overflow-hidden rounded-md border border-border/60"
                      >
                        <Image
                          src={signedPhotoUrls.get(p.url) ?? p.url}
                          alt=""
                          fill
                          sizes="80px"
                          className="object-cover"
                        />
                      </a>
                    ))}
                  </div>
                ) : null}

                <form action={updateStatus} className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[200px_1fr_auto]">
                  <input type="hidden" name="id" value={r.id} />
                  <Field label="Novi status">
                    <select
                      name="status"
                      defaultValue={r.status}
                      className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
                    >
                      {Object.values(ReclamationStatus).map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Napomena (vidljiva interno)">
                    <Textarea name="note" rows={2} />
                  </Field>
                  <div className="flex items-end justify-end">
                    <SubmitButton size="sm">Sačuvaj</SubmitButton>
                  </div>
                </form>

                {r.events.length > 0 ? (
                  <details className="mt-3 text-xs text-ink-500">
                    <summary className="cursor-pointer">Istorija statusa ({r.events.length})</summary>
                    <ul className="mt-2 space-y-1">
                      {r.events.map((e) => (
                        <li key={e.id}>
                          {e.createdAt.toLocaleString("sr-Latn-RS")} · {e.status}
                          {e.note ? ` — ${e.note}` : ""}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </Card>
            ))
          )}
        </div>
      </div>
    </>
  );
}

function FilterLink({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-1 ${active ? "bg-walnut text-white" : "bg-muted-bg text-ink-700 hover:bg-muted-bg/70"}`}
    >
      {label}
    </Link>
  );
}
