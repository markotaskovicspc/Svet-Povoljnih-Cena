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

const numbers = [
  { value: "12+", label: "godina iskustva" },
  { value: "30.000", label: "isporučenih komada" },
  { value: "120", label: "kolekcija u ponudi" },
  { value: "4.8/5", label: "prosečna ocena kupaca" },
];

export default function ONamaPage() {
  return (
    <>
      <div className="mx-auto w-full max-w-[var(--container-content)] px-6 pt-6">
        <Breadcrumbs trail={[{ label: "O nama" }]} />
      </div>
      <ContentHero
        eyebrow="Naša priča"
        title="Pošten nameštaj, poštena cena."
        lead="Verujemo da kvalitetan komad ne mora da bude luksuz. Biramo proizvođače čije materijale i izradu lično proveravamo, pa cenu držimo niskom uklanjajući sve što kupcu ne donosi vrednost."
      />
      <ContentBody>
        <ul className="not-prose -mx-6 mt-2 grid grid-cols-2 gap-4 px-6 sm:grid-cols-4">
          {numbers.map((n) => (
            <li
              key={n.label}
              className="bg-muted-bg/60 ring-border/60 rounded-2xl p-5 ring-1"
            >
              <p className="font-display text-3xl text-ink-900">{n.value}</p>
              <p className="mt-1 text-xs tracking-wide text-ink-500 uppercase">
                {n.label}
              </p>
            </li>
          ))}
        </ul>

        <ContentSection id="misija" title="Misija">
          <p>
            Da svaki dom u Srbiji može da priušti nameštaj koji izgleda dobro,
            traje godinama i lako se sklapa. Uskraćivanjem svega suvišnog —
            preplaćenih marži, šarenila reklama, kompliciranih lanaca — držimo
            cene niže i dostupnije.
          </p>
        </ContentSection>

        <ContentSection id="kako" title="Kako biramo proizvode">
          <ul>
            <li>
              <strong>Materijal pre dizajna.</strong> Svaki komad mora da prođe
              probu drveta, kvačila, šina i okova.
            </li>
            <li>
              <strong>Lokalna proizvodnja kad god je moguće.</strong> Kraći
              transport — niži CO₂ i niža cena.
            </li>
            <li>
              <strong>Ponavljajuće porudžbine.</strong> Kolekcije se proširuju
              postupno; odustajemo od onoga što kupci ne vole.
            </li>
          </ul>
        </ContentSection>

        <ContentSection id="tim" title="Naš tim">
          <p>
            Tridesetoro nas radi između Beograda i Novog Sada — od dizajnera i
            nabavljača do montera i podrške. Ako vidite naš kombi pred zgradom
            — to su Marko, Stefan i Aleksa.
          </p>
        </ContentSection>
      </ContentBody>
    </>
  );
}
