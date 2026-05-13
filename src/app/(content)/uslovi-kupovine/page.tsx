import type { Metadata } from "next";
import Link from "next/link";
import {
  ContentBody,
  ContentHero,
  ContentSection,
} from "@/components/layout/content-shell";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";

export const metadata: Metadata = {
  title: "Uslovi kupovine",
  description:
    "Pravila kupovine, načini plaćanja, povraćaj i odustanak od ugovora — Svet Akcija.",
};

export default function UsloviKupovinePage() {
  return (
    <>
      <div className="mx-auto w-full max-w-[var(--container-content)] px-6 pt-6">
        <Breadcrumbs trail={[{ label: "Uslovi kupovine" }]} />
      </div>
      <ContentHero
        eyebrow="Pravila"
        title="Uslovi kupovine."
        lead="Sve što treba da znate pre porudžbine — ko prodaje, kako se plaća, kako se vraća roba i koja prava imate kao potrošač."
      />
      <ContentBody>
        <ContentSection id="prodavac" title="Prodavac">
          <p>
            Prodavac je <strong>Svet Akcija d.o.o.</strong>, Vojvođanska
            401, 11000 Beograd, PIB 100000000, MB 20000000. Svi ugovori
            zaključuju se na srpskom jeziku.
          </p>
        </ContentSection>

        <ContentSection id="cene" title="Cene i poreze">
          <p>
            Cene su izražene u dinarima i sadrže PDV. Akcijska cena je istaknuta
            crvenom bojom uz prethodnu najnižu cenu u poslednjih 30 dana, u
            skladu sa Zakonom o zaštiti potrošača.
          </p>
        </ContentSection>

        <ContentSection id="kartice" title="Načini plaćanja">
          <ul>
            <li>Platnim karticama (Visa, Mastercard, DinaCard) — WSPay 3D Secure.</li>
            <li>IPS QR kodom (NBS).</li>
            <li>Apple Pay i Google Pay.</li>
            <li>Pouzeće — gotovinski ili karticom kod kurira.</li>
            <li>Uplatom na račun — predračun stiže e-poštom.</li>
          </ul>
        </ContentSection>

        <ContentSection id="ips" title="IPS plaćanje">
          <p>
            Skenirajte QR kod aplikacijom svoje banke i potvrdite — bez
            unošenja kartice. Potvrda plaćanja stiže odmah.
          </p>
        </ContentSection>

        <ContentSection id="wallet" title="Apple Pay & Google Pay">
          <p>
            Plaćanje iz novčanika telefona ili sata — bez deljenja kartičnih
            podataka. Zahteva podržan uređaj i karticu povezanu sa novčanikom.
          </p>
        </ContentSection>

        <ContentSection id="odustanak" title="Pravo na odustanak">
          <p>
            Imate pravo da odustanete od ugovora u roku od{" "}
            <strong>14 dana</strong> bez navođenja razloga. Obrazac za odustanak
            i adresa za povraćaj nalaze se u potvrdi porudžbine i u uputstvu uz
            artikal. Troškove povratnog transporta snosi kupac, osim u slučaju
            greške prodavca.
          </p>
        </ContentSection>

        <ContentSection id="garancija" title="Saobraznost i garancija">
          <p>
            Svi proizvodi su saobrazni opisu na sajtu i imaju zakonski rok od
            <strong> 24 meseca</strong>. Detaljnije o reklamacionom postupku:{" "}
            <Link href="/reklamacije">/reklamacije</Link>.
          </p>
        </ContentSection>

        <ContentSection id="sporovi" title="Vansudsko rešavanje sporova">
          <p>
            Eventualne sporove rešavamo dogovorno. Ako to nije moguće, nadležna
            su sudska tela u Beogradu, uz primenu prava Republike Srbije.
          </p>
        </ContentSection>
      </ContentBody>
    </>
  );
}
