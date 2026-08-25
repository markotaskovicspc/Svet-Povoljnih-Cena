import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdminAction } from "@/lib/admin";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardTitle } from "@/components/admin/card";
import { AdminActionForm } from "@/components/admin/action-form";
import { ContentPageEditor } from "@/components/admin/content-page-editor";
import { SubmitButton } from "@/components/admin/submit-button";
import { buttonVariants } from "@/components/ui/button";
import { isFunctionalContentPageSlug } from "@/lib/cms/system-pages";
import { resolveContactPageWidgetData } from "@/lib/cms/contact-page";
import {
  archiveContentPageAction,
  deleteContentPageDraftAction,
  restoreContentRevisionAction,
  saveContentPageAction,
  unarchiveContentPageAction,
} from "../actions";
import { contentPageStatus } from "../status";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Izmena stranice",
  robots: { index: false, follow: false },
};

export default async function EditContentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminAction(["CONTENT"]);
  const { id } = await params;
  const page = await db.contentPage.findUnique({
    where: { id },
    include: {
      revisions: {
        orderBy: { version: "desc" },
        take: 30,
        include: {
          createdBy: {
            select: { firstName: true, lastName: true, email: true },
          },
        },
      },
    },
  });
  if (!page) notFound();
  const status = contentPageStatus(page);
  const isFunctional = isFunctionalContentPageSlug(page.slug);

  return (
    <>
      <PageHeader
        title={page.title}
        description={`${status} · /${page.slug}`}
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/sadrzaj", label: "Stranice" },
          { label: page.title },
        ]}
        actions={
          page.published && !page.archivedAt ? (
            <Link href={`/${page.slug}`} target="_blank" className={buttonVariants({ variant: "outline" })}>
              Otvori javnu stranicu
            </Link>
          ) : undefined
        }
      />
      <div className="space-y-6 px-8 py-6">
        {page.archivedAt ? (
          <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-ink-700">
            Stranica je arhivirana i nije dostupna kupcima. Možete je vratiti među nacrte ili objaviti novu verziju.
          </div>
        ) : null}
        {isFunctional ? (
          <div className="rounded-xl border border-info/30 bg-info/10 px-4 py-3 text-sm text-ink-700">
            Uređujete tekst i SEO funkcionalne stranice. Njena forma, linkovi ili
            panel ostaju aktivni i ne mogu se ukloniti iz ovog editora.
          </div>
        ) : null}
        <ContentPageEditor
          action={saveContentPageAction}
          previewHref={`/admin/sadrzaj/${page.id}/pregled`}
          values={{
            id: page.id,
            revisionId: page.draftRevisionId,
            slug: page.slug,
            kind: page.kind,
            template: page.template,
            eyebrow: page.eyebrow,
            heroNote: page.heroNote,
            title: page.title,
            lead: page.lead,
            bodyMarkdown: page.bodyMarkdown,
            seoTitle: page.seoTitle,
            seoDescription: page.seoDescription,
            widgetData:
              page.slug === "kontakt"
                ? resolveContactPageWidgetData(page.widgetData)
                : null,
            footerVisible: page.footerVisible,
            footerLabel: page.footerLabel,
            footerColumn: page.footerColumn,
            footerOrder: page.footerOrder,
            lockedSlug: page.kind === "SYSTEM" || Boolean(page.publishedRevisionId),
          }}
        />

        <Card>
          <CardTitle description="Vraćanje pravi novi nacrt; javna verzija se ne menja dok ga ponovo ne objavite.">
            Istorija verzija
          </CardTitle>
          <div className="mt-4 divide-y divide-border/60">
            {page.revisions.map((revision) => {
              const author = revision.createdBy;
              const authorName = author
                ? [author.firstName, author.lastName].filter(Boolean).join(" ") || author.email
                : "Sistemski unos";
              const isDraft = revision.id === page.draftRevisionId;
              const isPublished = revision.id === page.publishedRevisionId;
              return (
                <div key={revision.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                  <span className="font-mono text-xs">v{revision.version}</span>
                  <span>{revision.title}</span>
                  {isDraft ? <span className="rounded-full bg-info/10 px-2 py-0.5 text-xs text-info">Aktuelni nacrt</span> : null}
                  {isPublished ? <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs text-success">Javno</span> : null}
                  <span className="text-xs text-ink-500">
                    {revision.createdAt.toLocaleString("sr-Latn-RS", { dateStyle: "short", timeStyle: "short" })} · {authorName}
                  </span>
                  {!isDraft ? (
                    <AdminActionForm action={restoreContentRevisionAction} className="ml-auto">
                      <input type="hidden" name="pageId" value={page.id} />
                      <input type="hidden" name="revisionId" value={revision.id} />
                      <SubmitButton variant="outline" size="xs" confirm={`Vratiti verziju v${revision.version} kao novi nacrt?`}>
                        Vrati kao nacrt
                      </SubmitButton>
                    </AdminActionForm>
                  ) : null}
                </div>
              );
            })}
          </div>
        </Card>

        {!isFunctional ? (
          <Card className="border-destructive/25">
            <CardTitle>Upravljanje stranicom</CardTitle>
            <div className="mt-4 flex flex-wrap gap-3">
              {page.archivedAt ? (
                <AdminActionForm action={unarchiveContentPageAction}>
                  <input type="hidden" name="id" value={page.id} />
                  <SubmitButton variant="outline">Vrati među nacrte</SubmitButton>
                </AdminActionForm>
              ) : (
                <AdminActionForm action={archiveContentPageAction}>
                  <input type="hidden" name="id" value={page.id} />
                  <SubmitButton variant="destructive" confirm="Arhivirati stranicu i ukloniti je sa javnog sajta i iz footera?">
                    Arhiviraj stranicu
                  </SubmitButton>
                </AdminActionForm>
              )}
              {page.kind === "CUSTOM" && !page.publishedRevisionId ? (
                <AdminActionForm action={deleteContentPageDraftAction}>
                  <input type="hidden" name="id" value={page.id} />
                  <SubmitButton variant="destructive" confirm="Trajno obrisati ovaj nikada objavljeni nacrt?">
                    Obriši nacrt
                  </SubmitButton>
                </AdminActionForm>
              ) : null}
            </div>
          </Card>
        ) : null}
      </div>
    </>
  );
}
