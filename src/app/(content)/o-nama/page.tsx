import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CmsContentPage } from "@/components/content/cms-content-page";
import { getPublishedContentPage } from "@/lib/cms/pages";

const SLUG = "o-nama";

export async function generateMetadata(): Promise<Metadata> {
  const page = await getPublishedContentPage(SLUG);
  return {
    title: page?.seoTitle ?? "O nama",
    description: page?.seoDescription,
    alternates: { canonical: `/${SLUG}` },
  };
}

export default async function ONamaPage() {
  const page = await getPublishedContentPage(SLUG);
  if (!page) notFound();
  return <CmsContentPage page={page} />;
}
