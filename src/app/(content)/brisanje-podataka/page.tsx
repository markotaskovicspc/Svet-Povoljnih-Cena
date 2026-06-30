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
  title: "Brisanje podataka",
  description:
    `Data Deletion Instructions za nalog, Facebook login i druge podatke - ${BRAND.name}.`,
};

export default function BrisanjePodatakaPage() {
  return (
    <>
      <div className="mx-auto w-full max-w-[var(--container-content)] px-6 pt-6">
        <Breadcrumbs trail={[{ label: "Brisanje podataka" }]} />
      </div>
      <ContentHero
        eyebrow="Data Deletion Instructions"
        title="Brisanje podataka."
        lead="Ovde su uputstva za podnošenje zahteva za brisanje naloga, podataka i povezane Facebook ili druge društvene prijave."
        meta={<>Poslednje izmene: 30. jun 2026.</>}
      />
      <ContentBody>
        <ContentSection id="zahtev" title="Kako da pošaljete zahtev">
          <ol>
            <li>
              Pošaljite e-poštu na{" "}
              <Link href="mailto:dpo@svetpovoljnihcena.rs">
                dpo@svetpovoljnihcena.rs
              </Link>{" "}
              ili{" "}
              <Link href={`mailto:${MERCHANT_LEGAL_INFO.email}`}>
                {MERCHANT_LEGAL_INFO.email}
              </Link>
              .
            </li>
            <li>
              U naslovu poruke navedite: <strong>Brisanje podataka</strong>.
            </li>
            <li>
              U poruci navedite e-poštu ili telefon koji koristite za nalog,
              kao i da li ste koristili Facebook, Google ili Apple prijavu.
            </li>
            <li>
              Nemojte slati lozinku, broj platne kartice ili dokumenta koja nisu
              potrebna za proveru identiteta.
            </li>
          </ol>
          <p>
            Ako zahtev šaljete sa iste e-pošte kojom je otvoren nalog, postupak
            provere je brži. Ako podatke ne možemo pouzdano povezati sa nalogom,
            zatražićemo dodatnu potvrdu identiteta.
          </p>
        </ContentSection>

        <ContentSection id="facebook" title="Facebook login">
          <p>
            Ako ste koristili Facebook login, u zahtevu navedite e-poštu koja je
            povezana sa Facebook nalogom ili korisničkim nalogom na našem sajtu.
            Od nas možete tražiti brisanje naloga, brisanje podataka koje smo
            dobili kroz Facebook login ili odvajanje Facebook naloga od vašeg
            profila.
          </p>
          <p>
            Pristup aplikacije možete ukloniti i direktno u svom Facebook nalogu:
            otvorite <strong>Podešavanja i privatnost</strong>, zatim{" "}
            <strong>Podešavanja</strong>, <strong>Aplikacije i veb-sajtovi</strong>,
            izaberite <strong>{BRAND.name}</strong> i uklonite pristup. Nazivi
            stavki mogu se razlikovati ako Facebook promeni interfejs.
          </p>
        </ContentSection>

        <ContentSection id="brisemo" title="Šta brišemo">
          <ul>
            <li>Korisnički profil i podatke za prijavu koje nije potrebno čuvati.</li>
            <li>Adrese, listu želja, podešavanja naloga i marketinške saglasnosti.</li>
            <li>Vezu sa Facebook, Google ili Apple nalogom, uključujući tokene ako postoje.</li>
            <li>Komentare, recenzije ili poruke koje možemo obrisati ili anonimizovati na zahtev.</li>
          </ul>
        </ContentSection>

        <ContentSection id="zadrzavamo" title="Podaci koje ne brišemo odmah">
          <p>
            Neke podatke moramo zadržati ograničeno vreme zbog zakonskih
            obaveza, zaštite potrošača, računovodstva, fiskalizacije,
            reklamacija, naplate, sprečavanja prevara ili odbrane pravnih
            zahteva. To se najčešće odnosi na porudžbine, račune, povraćaje,
            reklamacije i osnovne evidencije komunikacije.
          </p>
          <p>
            Podaci koji ostaju u rezervnim kopijama brišu se ili prepisuju kroz
            redovan ciklus čuvanja backup-a i više se ne koriste za aktivnu
            obradu.
          </p>
        </ContentSection>

        <ContentSection id="rokovi" title="Rokovi i potvrda">
          <p>
            Zahtev obrađujemo bez nepotrebnog odlaganja, a najkasnije u roku od
            30 dana od prijema potpunog i proverljivog zahteva. Ako je zahtev
            složen ili imamo veliki broj zahteva, obavestićemo vas o produženju
            roka u skladu sa propisima.
          </p>
          <p>
            Kada postupak završimo, poslaćemo potvrdu na e-poštu sa koje je
            zahtev poslat ili na drugu proverenu kontakt adresu.
          </p>
        </ContentSection>

        <ContentSection id="prava" title="Ostala prava">
          <p>
            Pored brisanja, možete tražiti pristup, ispravku, ograničenje obrade,
            prenos podataka ili prigovor. Detalji su opisani na stranici{" "}
            <Link href="/politika-privatnosti">Politika privatnosti</Link>.
          </p>
        </ContentSection>
      </ContentBody>
    </>
  );
}
