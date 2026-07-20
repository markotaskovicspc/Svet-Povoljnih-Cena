import type { Metadata } from "next";
import { CookieSettingsPanel } from "@/components/privacy/cookie-consent";
import { ContentBody, ContentHero } from "@/components/layout/content-shell";
import { getGa4MeasurementId } from "@/lib/analytics/config";

export const metadata: Metadata = {
  title: "Podešavanja kolačića",
  description: "Izaberite da li dozvoljavate analitičke kolačiće.",
};

export default function CookieSettingsPage() {
  const gaId = getGa4MeasurementId();
  return (
    <>
      <ContentHero title="Podešavanja kolačića" lead="Saglasnost možete promeniti u svakom trenutku." />
      <ContentBody><CookieSettingsPanel gaConfigured={Boolean(gaId?.startsWith("G-"))} /></ContentBody>
    </>
  );
}
