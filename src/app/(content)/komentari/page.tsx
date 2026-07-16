import type { Metadata } from "next";
import Link from "next/link";
import {
  ContentBody,
  ContentHero,
  ContentSection,
} from "@/components/layout/content-shell";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { CommentForm } from "./form";

export const metadata: Metadata = {
  title: "Komentari i sugestije",
  description:
    "Pohvale, predlozi i kritike — recite nam šta da poboljšamo. Čitamo svaku poruku.",
};

export default function KomentariPage() {
  return (
    <>
      <div className="mx-auto w-full max-w-[var(--container-content)] px-6 pt-6">
        <Breadcrumbs
          trail={[
            { label: "Servis za kupce", href: "/servis" },
            { label: "Komentari i sugestije" },
          ]}
        />
      </div>
      <ContentHero
        eyebrow="Vaš glas"
        title="Komentari i sugestije."
        lead="Kuratiramo sledeću kolekciju na osnovu povratnih informacija. Pošaljite nam šta nedostaje, šta da popravimo, ili šta vas je oduševilo."
      />
      <ContentBody>
        <ContentSection id="poruka" title="Pošaljite poruku">
          <p>
            Poruka se čuva u našem sistemu za podršku. Za podatke o konkretnoj
            porudžbini koristite e-poštu sa koje je porudžbina poslata.
          </p>
          <CommentForm />
        </ContentSection>

        <ContentSection id="odgovor" title="Šta očekivati od nas">
          <p>
            Poruke pregleda tim za podršku. Ako želite odgovor, javićemo se na
            adresu e-pošte koju ste naveli. Alternativno pišite na{" "}
            <Link href="mailto:podrska@svetpovoljnihcena.rs">
              podrska@svetpovoljnihcena.rs
            </Link>
            .
          </p>
        </ContentSection>
      </ContentBody>
    </>
  );
}
