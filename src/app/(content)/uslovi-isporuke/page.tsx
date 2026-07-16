import type { Metadata } from "next";
import Link from "next/link";
import {
  ContentBody,
  ContentHero,
  ContentSection,
} from "@/components/layout/content-shell";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";

export const metadata: Metadata = {
  title: "Uslovi isporuke",
  description:
    "Način obračuna rokova, cena i uslova isporuke porudžbine.",
};

export default function UsloviIsporukePage() {
  return (
    <>
      <div className="mx-auto w-full max-w-[var(--container-content)] px-6 pt-6">
        <Breadcrumbs trail={[{ label: "Uslovi isporuke" }]} />
      </div>
      <ContentHero
        eyebrow="Logistika"
        title="Uslovi isporuke."
        lead="Šta očekivati posle porudžbine — od potvrde, preko priprema, do dovoza i montaže."
      />
      <ContentBody>
        <ContentSection id="rokovi" title="Rokovi isporuke">
          <p>
            Procenjeni rok zavisi od potvrđene zalihe, vrste robe, adrese i
            izabrane službe. Rok koji važi za konkretnu porudžbinu prikazuje se
            pre njene potvrde i ponavlja u potvrdi porudžbine.
          </p>
          <p>
            Kurirska služba može naknadno najaviti termin kroz kanal koji sama
            podržava. Takva najava ne menja podatke o adresi bez potvrde kupca.
          </p>
        </ContentSection>

        <ContentSection id="tarifa" title="Cena isporuke i dodatnih usluga">
          <p>
            Cena se računa za konkretnu korpu i adresu. Dostava, unos i montaža
            nude se samo kada ih aktivni logistički partner podržava, a svaki
            iznos je prikazan odvojeno pre slanja porudžbine. Ne postoji opšti
            prag za besplatnu dostavu dok nije izričito prikazan u checkout-u.
          </p>
        </ContentSection>

        <ContentSection id="naplata" title="Kada se zadužuje vaš račun">
          <ul>
            <li>
              <strong>IPS Skeniraj i platne kartice (kada su dostupni):</strong> račun
              se zadužuje odmah po uspešnoj autorizaciji plaćanja, pre nego što
              porudžbina krene u pripremu za isporuku.
            </li>
            <li>
              <strong>Uplata na račun:</strong> sredstva se prenose kada vi
              izvršite uplatu po dobijenoj uplatnici; porudžbinu puštamo u
              pripremu tek po evidentiranju uplate na našem računu.
            </li>
            <li>
              <strong>Pouzeće (gotovina ili kartica kod kurira):</strong> iznos
              se naplaćuje tek pri preuzimanju pošiljke, na adresi isporuke.
            </li>
          </ul>
        </ContentSection>

        <ContentSection id="gradovi" title="Dostupnost montaže">
          <p>
            Montaža se ne podrazumeva. Ako je dostupna za artikal i adresu,
            biće ponuđena sa cenom pre potvrde porudžbine. Za proveru posebnih
            uslova kontaktirajte <Link href="/kontakt">podršku</Link>.
          </p>
        </ContentSection>

        <ContentSection id="prijem" title="Pri prijemu pošiljke">
          <ul>
            <li>Proverite spoljašnji izgled pakovanja pre potpisa.</li>
            <li>
              Ako ima vidljivih oštećenja — odbijte preuzimanje ili upišite
              napomenu na otpremnicu.
            </li>
            <li>
              Skrivena oštećenja prijavite bez odlaganja na stranici{" "}
              <Link href="/reklamacije">reklamacije</Link>.
            </li>
          </ul>
        </ContentSection>
      </ContentBody>
    </>
  );
}
