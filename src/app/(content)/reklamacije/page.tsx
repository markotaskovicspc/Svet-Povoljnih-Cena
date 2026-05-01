import type { Metadata } from "next";
import Link from "next/link";
import {
  ContentBody,
  ContentHero,
  ContentSection,
} from "@/components/layout/content-shell";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";

export const metadata: Metadata = {
  title: "Reklamacije",
  description:
    "Postupak za podnošenje reklamacije — koji podaci su potrebni, rokovi i način rešavanja.",
};

export default function ReklamacijePage() {
  return (
    <>
      <div className="mx-auto w-full max-w-[var(--container-content)] px-6 pt-6">
        <Breadcrumbs
          trail={[
            { label: "Servis za kupce", href: "/servis" },
            { label: "Reklamacije" },
          ]}
        />
      </div>
      <ContentHero
        eyebrow="Posle kupovine"
        title="Reklamacije."
        lead="Ako artikal ima nedostatak, oštećenje iz transporta ili ne odgovara opisu — javite nam u zakonskom roku, rešićemo brzo."
      />
      <ContentBody>
        <ContentSection id="rok" title="Rokovi">
          <ul>
            <li>
              <strong>Vidljiva oštećenja iz transporta:</strong> prijavite pri
              preuzimanju ili u roku od 24 sata.
            </li>
            <li>
              <strong>Skrivena oštećenja:</strong> u roku od 48 sati od prijema.
            </li>
            <li>
              <strong>Saobraznost:</strong> u roku od 24 meseca od kupovine.
            </li>
          </ul>
        </ContentSection>

        <ContentSection id="podaci" title="Šta je potrebno priložiti">
          <ul>
            <li>Broj porudžbine (vidi se u potvrdi e-pošte i u nalogu).</li>
            <li>Kratak opis problema.</li>
            <li>2–4 fotografije (oštećenje, etiketa, ambalaža).</li>
            <li>Vaš kontakt telefon za brzi povratni poziv.</li>
          </ul>
        </ContentSection>

        <ContentSection id="kako" title="Kako podneti reklamaciju">
          <ol>
            <li>
              Prijavite reklamaciju kroz formular u nalogu (
              <em>Moj nalog → Reklamacije</em>) ili e-poštom na{" "}
              <Link href="mailto:reklamacije@svetpovoljnihcena.rs">
                reklamacije@svetpovoljnihcena.rs
              </Link>
              .
            </li>
            <li>
              Dobićete potvrdu prijema u roku od 24h, sa brojem reklamacije.
            </li>
            <li>
              Tehnička služba donosi odluku u roku od <strong>8 dana</strong>{" "}
              (zakonski rok 15 dana).
            </li>
            <li>
              U dogovoru sa vama biramo: zamenu artikla, popravku, sniženje cene
              ili povraćaj sredstava.
            </li>
          </ol>
        </ContentSection>

        <ContentSection id="napomena" title="Šta nije reklamacija">
          <p>
            Mehanička oštećenja nastala neispravnim sklapanjem ili upotrebom
            van uputstva, kao i normalno habanje, nisu predmet saobraznosti.
            U tim slučajevima nudimo plaćeni servis i rezervne delove.
          </p>
        </ContentSection>
      </ContentBody>
    </>
  );
}
