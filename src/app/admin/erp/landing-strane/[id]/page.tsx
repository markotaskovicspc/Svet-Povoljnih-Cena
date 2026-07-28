import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminAction } from "@/lib/admin";
import { db } from "@/lib/db";
import { editableLandingSnapshot, landingAdminStatus } from "@/lib/landing-pages/admin";
import { LandingPageEditor } from "@/components/admin/landing-page-editor";
import { AdminActionForm } from "@/components/admin/action-form";
import { Card, CardTitle } from "@/components/admin/card";
import { PageHeader } from "@/components/admin/page-header";
import { SubmitButton } from "@/components/admin/submit-button";
import { buttonVariants } from "@/components/ui/button";
import {
  archiveLandingPageAction,
  deleteLandingDraftAction,
  duplicateLandingPageAction,
  restoreLandingRevisionAction,
  saveLandingPageAction,
  unarchiveLandingPageAction,
  unpublishLandingPageAction,
} from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Izmena landing strane", robots: { index: false, follow: false } };

export default async function EditLandingPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminAction(["CONTENT"]);
  const { id } = await params;
  const [page, pictograms] = await Promise.all([
    db.landingPage.findUnique({
      where: { id },
      include: {
        draftRevision: true,
        sections: { orderBy: { position: "asc" } },
        pictogramPlacements: true,
        revisions: {
          orderBy: { version: "desc" }, take: 30,
          include: { createdBy: { select: { firstName: true, lastName: true, email: true } } },
        },
      },
    }),
    db.pictogram.findMany({ select: { id: true, label: true, code: true, iconUrl: true }, orderBy: { label: "asc" } }),
  ]);
  if (!page) notFound();
  const snapshot = editableLandingSnapshot(page);
  const status = landingAdminStatus(page);
  return <>
    <PageHeader
      title={page.title}
      description={`${status} · /ponuda/${page.slug}`}
      crumbs={[{ href: "/admin", label: "Admin" }, { href: "/admin/erp/landing-strane", label: "Landing strane" }, { label: page.title }]}
      actions={<><Link href="/admin/erp/landing-strane" className={buttonVariants({ variant: "outline" })}>Nazad</Link><Link href={`/ponuda/${page.slug}?preview=1`} target="_blank" className={buttonVariants({ variant: "outline" })}>Pregled nacrta</Link></>}
    />
    <div className="space-y-6 px-8 py-6">
      <LandingPageEditor
        action={saveLandingPageAction}
        pictograms={pictograms}
        previewHref={`/ponuda/${page.slug}?preview=1`}
        values={{ id: page.id, slug: page.slug, ...snapshot, lockedSlug: Boolean(page.publishedRevisionId) }}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardTitle description="Vraćanje pravi novi nacrt i nikada ne prepisuje istoriju.">Istorija verzija</CardTitle>
          <div className="divide-y divide-border/60">
            {page.revisions.map((revision) => {
              const author = revision.createdBy;
              const authorName = author ? [author.firstName, author.lastName].filter(Boolean).join(" ") || author.email : "Sistemski unos";
              const published = revision.id === page.publishedRevisionId;
              const draft = revision.id === page.draftRevisionId;
              return <div key={revision.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <div className="min-w-0 flex-1"><p className="font-medium">Verzija {revision.version} {published ? <span className="ml-2 rounded-full bg-success/10 px-2 py-0.5 text-xs text-success">objavljena</span> : null} {draft ? <span className="ml-2 rounded-full bg-info/10 px-2 py-0.5 text-xs text-info">nacrt</span> : null}</p><p className="text-xs text-ink-500">{revision.createdAt.toLocaleString("sr-Latn-RS")} · {authorName}</p></div>
                {!draft ? <AdminActionForm action={restoreLandingRevisionAction}><input type="hidden" name="pageId" value={page.id} /><input type="hidden" name="revisionId" value={revision.id} /><SubmitButton variant="outline" size="sm" pendingLabel="Vraćanje…">Vrati kao nacrt</SubmitButton></AdminActionForm> : null}
              </div>;
            })}
          </div>
        </Card>

        <Card>
          <CardTitle description="Objavljene strane se arhiviraju umesto trajnog brisanja.">Upravljanje</CardTitle>
          <div className="space-y-3">
            <AdminActionForm action={duplicateLandingPageAction}><input type="hidden" name="id" value={page.id} /><SubmitButton variant="outline" className="w-full" pendingLabel="Kopiranje…">Napravi kopiju</SubmitButton></AdminActionForm>
            {page.status === "PUBLISHED" ? <AdminActionForm action={unpublishLandingPageAction}><input type="hidden" name="id" value={page.id} /><SubmitButton variant="outline" className="w-full" confirm="Povući landing stranu sa sajta?">Povuci sa sajta</SubmitButton></AdminActionForm> : null}
            {page.status === "ARCHIVED" ? <AdminActionForm action={unarchiveLandingPageAction}><input type="hidden" name="id" value={page.id} /><SubmitButton variant="outline" className="w-full">Vrati iz arhive</SubmitButton></AdminActionForm> : <AdminActionForm action={archiveLandingPageAction}><input type="hidden" name="id" value={page.id} /><SubmitButton variant="destructive" className="w-full" confirm="Arhivirati landing stranu? Više neće biti javno dostupna.">Arhiviraj</SubmitButton></AdminActionForm>}
            {!page.publishedRevisionId ? <AdminActionForm action={deleteLandingDraftAction}><input type="hidden" name="id" value={page.id} /><SubmitButton variant="destructive" className="w-full" confirm="Trajno obrisati ovaj nikada objavljen nacrt?">Trajno obriši nacrt</SubmitButton></AdminActionForm> : null}
          </div>
        </Card>
      </div>
    </div>
  </>;
}
