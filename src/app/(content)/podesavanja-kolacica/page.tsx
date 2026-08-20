import type { Metadata } from "next";
import { CmsFunctionalPage } from "@/components/content/cms-content-page";
import { CookieSettingsPanel } from "@/components/privacy/cookie-consent";
import { getGa4MeasurementId } from "@/lib/analytics/config";
import { getFunctionalContentPage } from "@/lib/cms/pages";

const SLUG = "podesavanja-kolacica";

export async function generateMetadata(): Promise<Metadata> {
  const page = await getFunctionalContentPage(SLUG);
  return {
    title: page.seoTitle ?? page.title,
    description: page.seoDescription,
    alternates: { canonical: `/${SLUG}` },
  };
}

export default async function CookieSettingsPage() {
  const page = await getFunctionalContentPage(SLUG);
  const gaId = getGa4MeasurementId();
  return (
    <CmsFunctionalPage page={page}>
      <div className="not-prose mt-8">
        <CookieSettingsPanel gaConfigured={Boolean(gaId?.startsWith("G-"))} />
      </div>
    </CmsFunctionalPage>
  );
}
