import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdminAction } from "@/lib/admin";
import { PageHeader } from "@/components/admin/page-header";
import { Card } from "@/components/admin/card";
import { DataTable } from "@/components/admin/data-table";
import { buttonVariants } from "@/components/ui/button";
import { footerColumnLabel } from "@/lib/cms/constants";
import { contentPageStatus } from "./status";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Stranice",
  robots: { index: false, follow: false },
};

function statusClass(status: string) {
  if (status === "Objavljeno") return "bg-success/10 text-success";
  if (status === "Arhivirano") return "bg-muted-bg text-ink-500";
  if (status.includes("izmene")) return "bg-warning/10 text-warning";
  return "bg-info/10 text-info";
}

const FUNCTIONAL_PUBLIC_PAGES = [
  { title: "Kontakt", slug: "kontakt", manageHref: null },
  { title: "Servis", slug: "servis", manageHref: null },
  { title: "Komentari", slug: "komentari", manageHref: "/admin/komentari" },
  {
    title: "Podešavanja kolačića",
    slug: "podesavanja-kolacica",
    manageHref: null,
  },
] as const;

export default async function ContentAdminPage() {
  await requireAdminAction(["CONTENT"]);
  const pages = await db.contentPage.findMany({
    orderBy: [{ archivedAt: "asc" }, { updatedAt: "desc" }, { title: "asc" }],
    include: {
      draftRevision: {
        select: {
          createdBy: {
            select: { firstName: true, lastName: true, email: true },
          },
        },
      },
      publishedRevision: {
        select: { footerVisible: true },
      },
    },
  });

  const counts = pages.reduce(
    (result, page) => {
      const status = contentPageStatus(page);
      if (status === "Objavljeno") result.published += 1;
      else if (status === "Arhivirano") result.archived += 1;
      else result.drafts += 1;
      if (
        !page.archivedAt &&
        page.published &&
        page.publishedRevision?.footerVisible
      ) {
        result.footer += 1;
      }
      return result;
    },
    { published: 0, drafts: 0, archived: 0, footer: 0 },
  );

  return (
    <>
      <PageHeader
        title="Stranice"
        description="Pravne, servisne i prilagođene stranice sa nacrtima, pregledom i istorijom objava."
        crumbs={[{ href: "/admin", label: "Admin" }, { label: "Sadržaj" }]}
        actions={
          <Link href="/admin/sadrzaj/nova" className={buttonVariants()}>
            Nova stranica
          </Link>
        }
      />
      <div className="space-y-6 px-8 py-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["Objavljeno", counts.published],
            ["Nacrti i izmene", counts.drafts],
            ["U footeru", counts.footer],
            ["Arhivirano", counts.archived],
          ].map(([label, value]) => (
            <Card key={String(label)} className="p-4">
              <p className="text-xs font-medium tracking-wide text-ink-500 uppercase">{label}</p>
              <p className="mt-2 font-display text-3xl text-ink-900">{value}</p>
            </Card>
          ))}
        </div>

        <DataTable
          columns={[
            { key: "title", label: "Stranica" },
            { key: "slug", label: "Javna adresa" },
            { key: "kind", label: "Tip" },
            { key: "status", label: "Status" },
            { key: "footer", label: "Footer" },
            { key: "updated", label: "Poslednja izmena" },
            { key: "author", label: "Autor" },
            { key: "actions", label: "", align: "right" },
          ]}
          rows={pages.map((page) => {
            const status = contentPageStatus(page);
            const author = page.draftRevision?.createdBy;
            const authorName = author
              ? [author.firstName, author.lastName].filter(Boolean).join(" ") || author.email
              : "Sistemski unos";
            return {
              id: page.id,
              cells: {
                title: (
                  <div>
                    <p className="font-medium text-ink-900">{page.title}</p>
                    {page.lead ? <p className="line-clamp-1 max-w-md text-xs text-ink-500">{page.lead}</p> : null}
                  </div>
                ),
                slug: <span className="font-mono text-xs">/{page.slug}</span>,
                kind: page.kind === "SYSTEM" ? "Sistemska" : "Prilagođena",
                status: <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusClass(status)}`}>{status}</span>,
                footer: page.footerVisible
                  ? `${footerColumnLabel(page.footerColumn) ?? "—"} · ${page.footerOrder ?? 999}`
                  : "Ne prikazuje se",
                updated: page.updatedAt.toLocaleString("sr-Latn-RS", {
                  dateStyle: "short",
                  timeStyle: "short",
                }),
                author: authorName,
                actions: (
                  <div className="flex justify-end gap-3">
                    {page.published && !page.archivedAt ? (
                      <Link href={`/${page.slug}`} target="_blank" className="text-xs text-ink-500 hover:text-walnut hover:underline">
                        Otvori
                      </Link>
                    ) : null}
                    <Link href={`/admin/sadrzaj/${page.id}`} className="text-xs font-medium text-walnut hover:underline">
                      Izmeni
                    </Link>
                  </div>
                ),
              },
            };
          })}
          empty="Nema CMS stranica. Pokrenite db:content-bootstrap posle migracije."
        />

        <div>
          <h2 className="mb-3 font-display text-xl font-semibold text-ink-900">
            Funkcionalne javne stranice
          </h2>
          <p className="mb-4 text-sm text-ink-500">
            Ove stranice imaju posebnu aplikacionu logiku, zato nisu izostavljene iz pregleda i ne uređuju se kao CMS tekst.
          </p>
          <DataTable
            columns={[
              { key: "title", label: "Stranica" },
              { key: "slug", label: "Javna adresa" },
              { key: "kind", label: "Tip" },
              { key: "status", label: "Status" },
              { key: "actions", label: "", align: "right" },
            ]}
            rows={FUNCTIONAL_PUBLIC_PAGES.map((page) => ({
              id: page.slug,
              cells: {
                title: <p className="font-medium text-ink-900">{page.title}</p>,
                slug: <span className="font-mono text-xs">/{page.slug}</span>,
                kind: "Funkcionalna",
                status: (
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusClass("Objavljeno")}`}>
                    Objavljeno
                  </span>
                ),
                actions: (
                  <div className="flex justify-end gap-3">
                    <Link href={`/${page.slug}`} target="_blank" className="text-xs text-ink-500 hover:text-walnut hover:underline">
                      Otvori
                    </Link>
                    {page.manageHref ? (
                      <Link href={page.manageHref} className="text-xs font-medium text-walnut hover:underline">
                        Upravljaj
                      </Link>
                    ) : null}
                  </div>
                ),
              },
            }))}
          />
        </div>
      </div>
    </>
  );
}
