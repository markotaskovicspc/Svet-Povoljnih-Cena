import type { Metadata } from "next";
import {
  ContentBody,
  ContentHero,
  ContentSection,
} from "@/components/layout/content-shell";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";

export const metadata: Metadata = {
  title: "O nama",
  description:
    "Priča o Svetu povoljnih cena — kuratiranoj selekciji nameštaja po poštenim cenama, sa fokusom na materijal, izradu i isporuku.",
};

export default function ONamaPage() {
  return (
    <>
      <div className="mx-auto w-full max-w-[var(--container-content)] px-6 pt-6">
        <Breadcrumbs trail={[{ label: "O nama" }]} />
      </div>
      <ContentHero
        eyebrow="Naša priča"
        title="Pošten nameštaj, poštena cena."
        lead="Gradimo preglednu internet prodavnicu nameštaja i opreme za dom, sa jasnim informacijama o ceni, dostupnosti i isporuci."
      />
      <ContentBody>
        <ContentSection id="misija" title="Misija">
          <p>
            Želimo da kupac pre poručivanja dobije proverljive podatke o
            proizvodu i sve troškove vidi pre konačne potvrde porudžbine.
          </p>
        </ContentSection>

        <ContentSection id="kako" title="Kako biramo proizvode">
          <ul>
            <li>
              <strong>Jasan opis.</strong> Objavljujemo specifikacije koje smo
              dobili i proverili sa dobavljačem.
            </li>
            <li>
              <strong>Vidljiva dostupnost.</strong> Status zaliha i procenjeni
              rok prikazujemo tamo gde imamo pouzdan podatak.
            </li>
            <li>
              <strong>Povratna informacija.</strong> Primedbe kupaca koristimo
              za ispravke kataloga i procesa.
            </li>
          </ul>
        </ContentSection>

        <ContentSection id="tim" title="Kako radimo">
          <p>
            Porudžbine obrađujemo kroz mrežu dobavljača, kurirskih službi i
            servisa koji se aktiviraju tek nakon tehničke i poslovne provere.
            Dostupne opcije uvek prikazujemo u korpi pre slanja porudžbine.
          </p>
        </ContentSection>
      </ContentBody>
    </>
  );
}
