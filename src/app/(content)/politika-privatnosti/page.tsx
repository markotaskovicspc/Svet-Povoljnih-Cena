import type { Metadata } from "next";
import Link from "next/link";
import {
  ContentBody,
  ContentHero,
  ContentSection,
} from "@/components/layout/content-shell";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";

export const metadata: Metadata = {
  title: "Politika privatnosti",
  description:
    "Kako prikupljamo, koristimo i čuvamo vaše lične podatke — Svet povoljnih cena.",
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
        meta={<>Poslednje izmene: 1. maj 2026.</>}
      />
      <ContentBody>
        <ContentSection id="rukovalac" title="Rukovalac podacima">
          <p>
            <strong>Svet povoljnih cena d.o.o.</strong>, Vojvođanska 401, 11000
            Beograd. Kontakt za zaštitu podataka:{" "}
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
            analitičke i marketinške. Pristanak možete povući u svakom trenutku
            kroz banner ili podešavanja u nalogu.
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
