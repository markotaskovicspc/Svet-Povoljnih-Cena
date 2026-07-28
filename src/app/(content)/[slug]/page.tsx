import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CmsContentPage } from "@/components/content/cms-content-page";
import { getPublishedCustomPage } from "@/lib/cms/pages";

type CustomContentPageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({
  params,
}: CustomContentPageProps): Promise<Metadata> {
  const { slug } = await params;
  const page = await getPublishedCustomPage(slug);
  if (!page) return {};
  return {
    title: page.seoTitle ?? page.title,
    description: page.seoDescription ?? page.lead,
    alternates: { canonical: `/${page.slug}` },
  };
}

export default async function CustomContentPage({ params }: CustomContentPageProps) {
  const { slug } = await params;
  const page = await getPublishedCustomPage(slug);
  if (!page) notFound();
  return <CmsContentPage page={page} />;
}
