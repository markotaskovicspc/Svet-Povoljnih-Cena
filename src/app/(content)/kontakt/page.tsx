import type { Metadata } from "next";
import { CmsFunctionalPage } from "@/components/content/cms-content-page";
import { ContactChannels } from "@/components/content/contact-channels";
import { resolveContactPageWidgetData } from "@/lib/cms/contact-page";
import { getFunctionalContentPage } from "@/lib/cms/pages";

const SLUG = "kontakt";

export async function generateMetadata(): Promise<Metadata> {
  const page = await getFunctionalContentPage(SLUG);
  return {
    title: page.seoTitle ?? page.title,
    description: page.seoDescription,
    alternates: { canonical: `/${SLUG}` },
  };
}

export default async function KontaktPage() {
  const page = await getFunctionalContentPage(SLUG);
  const contactData = resolveContactPageWidgetData(page.widgetData);
  return (
    <CmsFunctionalPage page={page} widgetPosition="before">
      <ContactChannels data={contactData} />
    </CmsFunctionalPage>
  );
}
