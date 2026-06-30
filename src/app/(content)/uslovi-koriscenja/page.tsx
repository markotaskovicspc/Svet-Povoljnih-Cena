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
  title: "Uslovi korišćenja",
  description:
    `Pravila korišćenja sajta, aplikacije, naloga i društvene prijave - ${BRAND.name}.`,
};

export default function UsloviKoriscenjaPage() {
  return (
    <>
      <div className="mx-auto w-full max-w-[var(--container-content)] px-6 pt-6">
        <Breadcrumbs trail={[{ label: "Uslovi korišćenja" }]} />
      </div>
      <ContentHero
        eyebrow="Korišćenje sajta"
        title="Uslovi korišćenja."
        lead="Ova pravila uređuju pristup sajtu, aplikaciji, korisničkom nalogu, društvenoj prijavi i sadržaju koji objavljujemo."
        meta={<>Poslednje izmene: 30. jun 2026.</>}
      />
      <ContentBody>
        <ContentSection id="opseg" title="Opseg primene">
          <p>
            Ovi uslovi važe za korišćenje veb-sajta, aplikacije, naloga,
            formulara, korpe, liste želja, komentara, recenzija i drugih
            digitalnih funkcionalnosti koje pruža <strong>{BRAND.name}</strong>.
            Korišćenjem sajta ili aplikacije potvrđujete da ste pročitali i
            prihvatili ove uslove.
          </p>
          <p>
            Za kupovinu proizvoda primenjuju se naši{" "}
            <Link href="/uslovi-kupovine">Uslovi kupovine</Link>, a za dostavu{" "}
            <Link href="/uslovi-isporuke">Uslovi isporuke</Link>.
          </p>
        </ContentSection>

        <ContentSection id="nalog" title="Korisnički nalog">
          <ul>
            <li>
              Podatke za nalog morate unositi tačno, potpuno i ažurno, naročito
              e-poštu, telefon i adresu za isporuku.
            </li>
            <li>
              Odgovorni ste za čuvanje pristupnih podataka i sve aktivnosti
              koje nastanu preko vašeg naloga, osim ako je do zloupotrebe došlo
              našom greškom.
            </li>
            <li>
              Možemo privremeno ograničiti ili zatvoriti nalog ako postoji
              sumnja na zloupotrebu, pokušaj prevare, neovlašćen pristup,
              automatizovano preuzimanje sadržaja ili kršenje ovih uslova.
            </li>
            <li>
              Nalog možete prestati da koristite u svakom trenutku, a zahtev za
              brisanje podataka možete poslati prema uputstvu na stranici{" "}
              <Link href="/brisanje-podataka">Brisanje podataka</Link>.
            </li>
          </ul>
        </ContentSection>

        <ContentSection id="facebook-login" title="Facebook login i društvena prijava">
          <p>
            Ako izaberete prijavu preko Facebook-a ili drugog podržanog
            provajdera, provajder nam dostavlja podatke za identifikaciju naloga
            u skladu sa dozvolama koje ste odobrili, najčešće ime, e-poštu,
            javni identifikator naloga i eventualno profilnu sliku. Te podatke
            koristimo za kreiranje ili povezivanje naloga, prijavu i zaštitu od
            zloupotrebe.
          </p>
          <p>
            Ne dobijamo vašu Facebook lozinku. Pristup aplikacije možete
            opozvati u podešavanjima svog Facebook naloga, a od nas možete
            tražiti brisanje ili odvajanje povezanog društvenog naloga preko{" "}
            <Link href="/brisanje-podataka">instrukcija za brisanje podataka</Link>.
          </p>
        </ContentSection>

        <ContentSection id="dozvoljeno-koriscenje" title="Dozvoljeno korišćenje">
          <p>
            Sajt i aplikaciju možete koristiti samo za lične i zakonite potrebe:
            pregled proizvoda, upravljanje nalogom, kupovinu, komunikaciju sa
            podrškom i ostale funkcije koje su javno dostupne.
          </p>
          <ul>
            <li>Nije dozvoljen pokušaj neovlašćenog pristupa sistemima ili tuđim nalozima.</li>
            <li>Nije dozvoljeno ometanje rada sajta, slanje malicioznog koda ili testiranje bez odobrenja.</li>
            <li>Nije dozvoljeno masovno kopiranje, scraping ili preprodaja sadržaja bez naše pisane saglasnosti.</li>
            <li>Nije dozvoljeno lažno predstavljanje, zloupotreba promo kodova ili otvaranje naloga radi zaobilaženja ograničenja.</li>
          </ul>
        </ContentSection>

        <ContentSection id="sadrzaj" title="Sadržaj, komentari i intelektualna svojina">
          <p>
            Tekstovi, fotografije, logo, dizajn, kategorije, opisi proizvoda i
            drugi elementi sajta zaštićeni su pravima intelektualne svojine ili
            licencama dobavljača. Ne smete ih koristiti van uobičajenog
            pregleda sajta bez dozvole.
          </p>
          <p>
            Ako ostavite komentar, recenziju ili sugestiju, potvrđujete da je
            sadržaj zakonit i da ne povređuje prava trećih lica. Zadržavamo
            pravo moderacije sadržaja koji sadrži uvrede, govor mržnje, lične
            podatke trećih lica, netačne tvrdnje ili komercijalni spam.
          </p>
        </ContentSection>

        <ContentSection id="odgovornost" title="Dostupnost i ograničenje odgovornosti">
          <p>
            Trudimo se da sajt, aplikacija, cene, dostupnost i opisi proizvoda
            budu tačni i dostupni, ali ne možemo garantovati neprekidan rad bez
            greške, prekida, tehničkog održavanja ili povremenih netačnosti.
          </p>
          <p>
            U meri dozvoljenoj zakonom, ne odgovaramo za indirektnu štetu,
            izgubljenu dobit, gubitak podataka, nemogućnost korišćenja sajta ili
            posledice korišćenja informacija van njihove namene. Ova odredba ne
            ograničava vaša obavezna prava potrošača, prava u vezi sa
            saobraznošću proizvoda, pravo na reklamaciju ili druga prava koja se
            ne mogu isključiti zakonom.
          </p>
        </ContentSection>

        <ContentSection id="privatnost" title="Privatnost i brisanje podataka">
          <p>
            Način na koji prikupljamo, koristimo, čuvamo i štitimo lične podatke
            opisan je na stranici{" "}
            <Link href="/politika-privatnosti">Politika privatnosti</Link>.
            Zahtev za pristup, ispravku, ograničenje, prenos ili brisanje
            podataka možete poslati prema uputstvu na stranici{" "}
            <Link href="/brisanje-podataka">Brisanje podataka</Link>.
          </p>
        </ContentSection>

        <ContentSection id="izmene" title="Izmene uslova i kontakt">
          <p>
            Uslove možemo ažurirati kada menjamo funkcionalnosti, pravila naloga,
            načine prijave, bezbednosne procese ili zakonske obaveze. Nova
            verzija važi od objave na ovoj stranici, osim ako je naveden kasniji
            datum primene.
          </p>
          <p>
            Za pitanja o ovim uslovima obratite se na{" "}
            <Link href={`mailto:${MERCHANT_LEGAL_INFO.email}`}>
              {MERCHANT_LEGAL_INFO.email}
            </Link>
            .
          </p>
        </ContentSection>
      </ContentBody>
    </>
  );
}
