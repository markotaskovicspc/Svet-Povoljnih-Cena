import Link from "next/link";
import { requireAdminAction } from "@/lib/admin";
import { SimpleLandingPageEditor } from "@/components/admin/simple-landing-page-editor";
import { PageHeader } from "@/components/admin/page-header";
import { buttonVariants } from "@/components/ui/button";
import { saveLandingPageAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nova landing strana", robots: { index: false, follow: false } };

export default async function NewLandingPage() {
  await requireAdminAction(["CONTENT"]);
  return <>
    <PageHeader
      title="Nova landing strana"
      description="Napravite nacrt, zatim dodajte slike i proverite javni pregled pre objave."
      crumbs={[{ href: "/admin", label: "Admin" }, { href: "/admin/erp/landing-strane", label: "Landing strane" }, { label: "Nova" }]}
      actions={<Link href="/admin/erp/landing-strane" className={buttonVariants({ variant: "outline" })}>Nazad na listu</Link>}
    />
    <div className="px-8 py-6">
      <SimpleLandingPageEditor
        action={saveLandingPageAction}
        initialProducts={[]}
        values={{
          slug: "", title: "",
          heroImageUrl: null, heroMobileImageUrl: null, heroImageAlt: null,
          heroCtaLabel: null, heroCtaHref: "#proizvodi",
          productSkus: [], seoTitle: null, seoDescription: null, ogImageUrl: null,
          canonicalUrl: null, robotsIndex: true, startsAt: null, endsAt: null,
          lockedSlug: false,
        }}
      />
    </div>
  </>;
}
