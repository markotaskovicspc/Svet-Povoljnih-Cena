import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdminAction } from "@/lib/admin";
import { CmsContentPage } from "@/components/content/cms-content-page";
import { buttonVariants } from "@/components/ui/button";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Pregled nacrta",
  robots: { index: false, follow: false },
};

export default async function ContentPagePreview({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminAction(["CONTENT"]);
  const { id } = await params;
  const page = await db.contentPage.findUnique({ where: { id } });
  if (!page) notFound();
  return (
    <div className="pb-12">
      <div className="sticky top-0 z-40 flex flex-wrap items-center gap-3 border-b border-border bg-ink-900 px-6 py-3 text-white">
        <span className="font-medium">Pregled nacrta · nije javno</span>
        <span className="font-mono text-xs text-white/60">/{page.slug}</span>
        <Link href={`/admin/sadrzaj/${page.id}`} className={`${buttonVariants({ variant: "outline", size: "sm" })} ml-auto bg-white text-ink-900`}>
          Nazad na uređivanje
        </Link>
      </div>
      <CmsContentPage
        page={{
          id: page.id,
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
          footerVisible: page.footerVisible,
          footerLabel: page.footerLabel,
          footerColumn: page.footerColumn,
          footerOrder: page.footerOrder,
          updatedAt: page.updatedAt,
        }}
        parentTrail={page.slug === "reklamacije" ? [{ label: "Servis za kupce", href: "/servis" }] : []}
      />
    </div>
  );
}
