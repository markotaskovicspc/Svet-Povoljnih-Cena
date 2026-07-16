import type { Metadata } from "next";
import Link from "next/link";
import {
  ContentBody,
  ContentHero,
  ContentSection,
} from "@/components/layout/content-shell";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Pomoć",
  description:
    `Često postavljana pitanja o porudžbinama, dostavi, plaćanju i nalogu — ${BRAND.name}.`,
};

const faqs = [
  {
    q: "Koliko traje isporuka?",
    a: "Rok zavisi od potvrđene zalihe, adrese i izabrane dostave. Procena za konkretnu porudžbinu prikazuje se pre potvrde.",
  },
  {
    q: "Kako da pratim porudžbinu?",
    a: 'Status porudžbine vidite u sekciji "Moje porudžbine" u nalogu, a takođe vam stiže potvrda na e-poštu kada porudžbina krene iz skladišta.',
  },
  {
    q: "Mogu li da poručim bez registracije?",
    a: 'Da, ako je opcija „Nastavi kao gost” ponuđena u checkout-u. Eventualni popust važi samo kada je izričito prikazan i obračunat pre potvrde.',
  },
  {
    q: "Da li sklapate nameštaj?",
    a: "Montaža se nudi samo kada je dostupna za konkretan artikal i adresu. Cena se prikazuje u checkout-u pre potvrde.",
  },
  {
    q: "Kako da iskoristim vaučer?",
    a: 'Vaučer unesite na koraku "Vaučer" u toku checkouta. Vaučeri se ne kombinuju, osim ako u uslovima vaučera nije drugačije navedeno.',
  },
  {
    q: "Mogu li da vratim nameštaj?",
    a: "Da, imate 14 dana na odustanak. Detalje pogledajte u Uslovima kupovine.",
  },
];

export default function PomocPage() {
  return (
    <>
      <div className="mx-auto w-full max-w-[var(--container-content)] px-6 pt-6">
        <Breadcrumbs trail={[{ label: "Pomoć" }]} />
      </div>
      <ContentHero
        eyebrow="Često pitanja"
        title="Pomoć i česta pitanja."
        lead="Najbrži odgovori na najčešća pitanja. Ako vam nešto nedostaje — pišite nam."
      />
      <ContentBody>
        <ul className="not-prose mt-2 divide-y divide-border/60 border-y border-border/60">
          {faqs.map((f) => (
            <li key={f.q} className="py-5">
              <h3 className="font-display text-lg text-ink-900">{f.q}</h3>
              <p className="mt-2 text-ink-700">{f.a}</p>
            </li>
          ))}
        </ul>

        <ContentSection id="dalje" title="Niste pronašli odgovor?">
          <p>
            Pišite nam preko <Link href="/kontakt">kontakt strane</Link>, ili
            otvorite zahtev u <Link href="/servis">Servisu za kupce</Link> — tu
            su i reklamacije, izmene porudžbine i komentari.
          </p>
        </ContentSection>
      </ContentBody>
    </>
  );
}
