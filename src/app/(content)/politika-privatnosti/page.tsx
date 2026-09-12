import { ProductArCountNotice } from "@/components/privacy/product-ar-count-notice";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CmsFunctionalPage } from "@/components/content/cms-content-page";
import { getPublishedContentPage } from "@/lib/cms/pages";

const SLUG = "politika-privatnosti";

export async function generateMetadata(): Promise<Metadata> {
  const page = await getPublishedContentPage(SLUG);
  return {
    title: page?.seoTitle ?? "Politika privatnosti",
    description: page?.seoDescription,
    alternates: { canonical: `/${SLUG}` },
  };
}

export default async function PrivatnostPage() {
  const page = await getPublishedContentPage(SLUG);
  if (!page) notFound();
  return <CmsFunctionalPage page={page}><ProductArCountNotice /></CmsFunctionalPage>;
}
