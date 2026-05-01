import type { Metadata } from "next";
import Link from "next/link";
import {
  ContentBody,
  ContentHero,
  ContentSection,
} from "@/components/layout/content-shell";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";

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
        <ContentSection id="kanali" title="Kako da nas dosegnete">
          <ul>
            <li>
              E-pošta:{" "}
              <Link href="mailto:hello@svetpovoljnihcena.rs">
                hello@svetpovoljnihcena.rs
              </Link>
            </li>
            <li>
              Viber & WhatsApp:{" "}
              <Link href="viber://chat?number=%2B381644444555">+381 64 4444 555</Link>
            </li>
            <li>
              Anonimna anketa nakon isporuke (link stiže e-poštom 7 dana posle
              prijema artikla).
            </li>
          </ul>
        </ContentSection>

        <ContentSection id="odgovor" title="Šta očekivati od nas">
          <p>
            Sve poruke čita osnivač lično. Na konkretne predloge odgovaramo u
            roku od 7 dana. Najbolje sugestije ulaze u <em>changelog</em> sajta
            i u plan razvoja kolekcija.
          </p>
        </ContentSection>

        <ContentSection id="recenzije" title="Pišite recenziju proizvoda">
          <p>
            Recenzije ostavljate sa stranice proizvoda nakon kupovine — bilo
            preko e-mail poziva za ocenjivanje, bilo iz sekcije{" "}
            <em>Moje porudžbine</em> u nalogu. Recenzije objavljujemo bez
            cenzure (osim govora mržnje i ličnih podataka trećih lica).
          </p>
        </ContentSection>
      </ContentBody>
    </>
  );
}
