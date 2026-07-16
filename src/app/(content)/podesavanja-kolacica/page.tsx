import type { Metadata } from "next";
import { CookieSettingsPanel } from "@/components/privacy/cookie-consent";
import { ContentBody, ContentHero } from "@/components/layout/content-shell";

export const metadata: Metadata = {
  title: "Podešavanja kolačića",
  description: "Izaberite da li dozvoljavate analitičke kolačiće.",
};

export default function CookieSettingsPage() {
  const gaId = process.env.NEXT_PUBLIC_GA4_ID;
  return (
    <>
      <ContentHero title="Podešavanja kolačića" lead="Saglasnost možete promeniti u svakom trenutku." />
      <ContentBody><CookieSettingsPanel gaConfigured={Boolean(gaId?.startsWith("G-"))} /></ContentBody>
    </>
  );
}
