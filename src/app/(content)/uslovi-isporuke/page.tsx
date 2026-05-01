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
    "Rokovi, cene i način isporuke — kurirska služba, kamionska dostava i montaža u glavnim gradovima.",
};

const tarifa = [
  { tip: "Kurirska služba (do 30 kg)", cena: "590 RSD", napomena: "1–3 radna dana" },
  { tip: "Kamionska dostava do ulaza", cena: "od 2.490 RSD", napomena: "3–5 radnih dana" },
  { tip: "Unos u stan / sobu", cena: "+ 990 RSD po komadu", napomena: "po dogovoru sa vozačem" },
  { tip: "Montaža", cena: "10% vrednosti komada", napomena: "min. 2.500 RSD" },
];

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
            Standardni rok je <strong>3–5 radnih dana</strong> za artikle sa
            stanja, odnosno <strong>10–20 radnih dana</strong> kada se artikal
            dovozi po porudžbini (oznaka „dostupno za isporuku za …" na
            stranici proizvoda).
          </p>
          <p>
            Tačan datum potvrđujemo telefonom ili Viber porukom, dan pre
            dolaska. Vozač zove ~30 minuta unapred.
          </p>
        </ContentSection>

        <ContentSection id="tarifa" title="Cenovnik">
          <div className="not-prose mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-border/60 border-b text-left">
                  <th className="py-3 pr-4 font-mono text-[11px] tracking-wider text-ink-500 uppercase">
                    Tip isporuke
                  </th>
                  <th className="py-3 pr-4 font-mono text-[11px] tracking-wider text-ink-500 uppercase">
                    Cena
                  </th>
                  <th className="py-3 font-mono text-[11px] tracking-wider text-ink-500 uppercase">
                    Napomena
                  </th>
                </tr>
              </thead>
              <tbody>
                {tarifa.map((r) => (
                  <tr key={r.tip} className="border-border/40 border-b last:border-0">
                    <td className="py-3 pr-4 text-ink-900">{r.tip}</td>
                    <td className="py-3 pr-4 font-mono text-ink-900">{r.cena}</td>
                    <td className="py-3 text-ink-700">{r.napomena}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-sm text-ink-500">
            Besplatna kurirska isporuka za porudžbine preko 30.000 RSD.
          </p>
        </ContentSection>

        <ContentSection id="gradovi" title="Gradovi sa montažom">
          <p>
            Montažu trenutno radimo u: Beogradu, Novom Sadu, Nišu, Kragujevcu,
            Subotici, Pančevu, Čačku i Kraljevu. Listu redovno proširujemo —
            ako vaš grad nije na listi, javite se{" "}
            <Link href="/kontakt">podršci</Link>.
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
              Skrivena oštećenja prijavite u roku od 48 sati na{" "}
              <Link href="/reklamacije">reklamacije</Link>.
            </li>
          </ul>
        </ContentSection>
      </ContentBody>
    </>
  );
}
