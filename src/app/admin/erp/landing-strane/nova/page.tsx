import Link from "next/link";
import { requireAdminAction } from "@/lib/admin";
import { db } from "@/lib/db";
import { EMPTY_HERO_PICTOGRAMS } from "@/lib/landing-pages/blocks";
import { LandingPageEditor } from "@/components/admin/landing-page-editor";
import { PageHeader } from "@/components/admin/page-header";
import { buttonVariants } from "@/components/ui/button";
import { saveLandingPageAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nova landing strana", robots: { index: false, follow: false } };

export default async function NewLandingPage() {
  await requireAdminAction(["CONTENT"]);
  const pictograms = await db.pictogram.findMany({
    select: { id: true, label: true, code: true, iconUrl: true },
    orderBy: { label: "asc" },
  });
  return <>
    <PageHeader
      title="Nova landing strana"
      description="Napravite nacrt, zatim dodajte slike i proverite javni pregled pre objave."
      crumbs={[{ href: "/admin", label: "Admin" }, { href: "/admin/erp/landing-strane", label: "Landing strane" }, { label: "Nova" }]}
      actions={<Link href="/admin/erp/landing-strane" className={buttonVariants({ variant: "outline" })}>Nazad na listu</Link>}
    />
    <div className="px-8 py-6">
      <LandingPageEditor
        action={saveLandingPageAction}
        pictograms={pictograms}
        values={{
          slug: "", title: "", lead: null,
          heroImageUrl: null, heroMobileImageUrl: null, heroImageAlt: null,
          heroCtaLabel: null, heroCtaHref: null,
          heroPictograms: EMPTY_HERO_PICTOGRAMS,
          blocks: [], seoTitle: null, seoDescription: null, ogImageUrl: null,
          canonicalUrl: null, robotsIndex: true, startsAt: null, endsAt: null,
          lockedSlug: false,
        }}
      />
    </div>
  </>;
}
