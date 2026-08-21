import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CmsFunctionalPage } from "@/components/content/cms-content-page";
import { getPublishedContentPage } from "@/lib/cms/pages";
import { GuestReclamationLinkRequestForm } from "./guest-link-request-form";

const SLUG = "reklamacije";

export async function generateMetadata(): Promise<Metadata> {
  const page = await getPublishedContentPage(SLUG);
  return {
    title: page?.seoTitle ?? "Reklamacije",
    description: page?.seoDescription,
    alternates: { canonical: `/${SLUG}` },
  };
}

export default async function ReklamacijePage() {
  const page = await getPublishedContentPage(SLUG);
  if (!page) notFound();
  return (
    <CmsFunctionalPage
      page={page}
      parentTrail={[{ label: "Servis za kupce", href: "/servis" }]}
      widgetPosition="before"
    >
      <GuestReclamationLinkRequestForm />
    </CmsFunctionalPage>
  );
}
