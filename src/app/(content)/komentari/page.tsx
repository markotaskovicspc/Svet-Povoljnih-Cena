import type { Metadata } from "next";
import { CmsFunctionalPage } from "@/components/content/cms-content-page";
import { getFunctionalContentPage } from "@/lib/cms/pages";
import { CommentForm } from "./form";

const SLUG = "komentari";

export async function generateMetadata(): Promise<Metadata> {
  const page = await getFunctionalContentPage(SLUG);
  return {
    title: page.seoTitle ?? page.title,
    description: page.seoDescription,
    alternates: { canonical: `/${SLUG}` },
  };
}

export default async function KomentariPage() {
  const page = await getFunctionalContentPage(SLUG);
  return (
    <CmsFunctionalPage
      page={page}
      parentTrail={[{ label: "Servis za kupce", href: "/servis" }]}
    >
      <div className="not-prose mt-6">
        <CommentForm />
      </div>
    </CmsFunctionalPage>
  );
}
