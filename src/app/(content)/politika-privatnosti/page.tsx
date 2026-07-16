import type { Metadata } from "next";
import Link from "next/link";
import {
  ContentBody,
  ContentHero,
  ContentSection,
} from "@/components/layout/content-shell";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { BRAND } from "@/lib/brand";
import { MERCHANT_LEGAL_INFO } from "@/lib/merchant";

export const metadata: Metadata = {
  title: "Politika privatnosti",
  description:
    `Kako prikupljamo, koristimo i čuvamo vaše lične podatke — ${BRAND.name}.`,
};

export default function PrivatnostPage() {
  return (
    <>
      <div className="mx-auto w-full max-w-[var(--container-content)] px-6 pt-6">
        <Breadcrumbs trail={[{ label: "Politika privatnosti" }]} />
      </div>
      <ContentHero
        eyebrow="GDPR & ZZPL"
        title="Politika privatnosti."
        lead="Vaše podatke koristimo isključivo za realizaciju porudžbine, podršku i — ako date pristanak — za informisanje o akcijama."
        meta={<>Poslednje izmene: 30. jun 2026.</>}
      />
      <ContentBody>
        <ContentSection id="rukovalac" title="Rukovalac podacima">
          <p>
            <strong>{MERCHANT_LEGAL_INFO.name}</strong>,{" "}
            {MERCHANT_LEGAL_INFO.shortAddress}. Kontakt za zaštitu podataka:{" "}
            <Link href="mailto:dpo@svetpovoljnihcena.rs">
              dpo@svetpovoljnihcena.rs
            </Link>
            .
          </p>
        </ContentSection>

        <ContentSection id="podaci" title="Koje podatke obrađujemo">
          <ul>
            <li>Ime i prezime, adresa, e-pošta, telefon.</li>
            <li>Podaci o porudžbinama, plaćanju i isporuci.</li>
            <li>
              Tehnički podaci o uređaju i poseti (IP, kolačići, statistika).
            </li>
            <li>
              Podaci iz društvene prijave, uključujući Facebook login, kada ga
              sami izaberete za prijavu ili registraciju.
            </li>
            <li>
              Komunikacija sa podrškom (pošta, Viber, telefonski razgovori —
              ako ste o tome obavešteni).
            </li>
          </ul>
        </ContentSection>

        <ContentSection id="osnov" title="Pravni osnov i svrhe">
          <ul>
            <li>
              <strong>Izvršenje ugovora</strong> — obrada porudžbine, isporuka,
              fakturisanje.
            </li>
            <li>
              <strong>Zakonska obaveza</strong> — knjigovodstvo, fiskalizacija.
            </li>
            <li>
              <strong>Pristanak</strong> — newsletter, personalizovane akcije.
            </li>
            <li>
              <strong>Legitimni interes</strong> — sprečavanje prevara,
              poboljšanje sajta.
            </li>
          </ul>
        </ContentSection>

        <ContentSection id="kolacici" title="Kolačići">
          <p>
            Koristimo nužne kolačiće (sesija, korpa) i — uz vaš pristanak —
            analitičke kolačiće. Analitika se ne učitava pre pristanka.
            Pristanak možete promeniti u svakom trenutku na stranici{" "}
            <Link href="/podesavanja-kolacica">Podešavanja kolačića</Link> ili
            kroz podešavanja naloga.
          </p>
        </ContentSection>

        <ContentSection id="drustvene-prijave" title="Društvene prijave">
          <p>
            Kada koristite Facebook, Google ili Apple prijavu, obrađujemo podatke
            koje nam provajder dostavi u skladu sa dozvolama koje ste odobrili,
            najčešće ime, e-poštu i javni identifikator naloga. Te podatke
            koristimo za prijavu, povezivanje naloga i zaštitu od zloupotrebe.
          </p>
          <p>
            Zahtev za brisanje ili odvajanje društvene prijave možete poslati
            prema uputstvu na stranici{" "}
            <Link href="/brisanje-podataka">Brisanje podataka</Link>.
          </p>
        </ContentSection>

        <ContentSection id="prava" title="Vaša prava">
          <ul>
            <li>Pristup, ispravka, brisanje i prenos podataka.</li>
            <li>Ograničenje obrade i prigovor.</li>
            <li>
              Podnošenje pritužbe Povereniku za informacije od javnog značaja i
              zaštitu podataka o ličnosti.
            </li>
          </ul>
          <p>
            Zahtev podnesite na{" "}
            <Link href="mailto:dpo@svetpovoljnihcena.rs">
              dpo@svetpovoljnihcena.rs
            </Link>
            . Odgovor stiže u roku od 30 dana.
          </p>
        </ContentSection>

        <ContentSection id="cuvanje" title="Koliko čuvamo podatke">
          <p>
            Podatke o porudžbinama čuvamo 10 godina (poreske obaveze).
            Marketing podatke do povlačenja pristanka. Tehničke logove do 12
            meseci.
          </p>
        </ContentSection>
      </ContentBody>
    </>
  );
}
