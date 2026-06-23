import type { Metadata } from "next";
import Link from "next/link";
import { db, hasDatabaseConnection } from "@/lib/db";
import {
  ContentBody,
  ContentHero,
  ContentSection,
} from "@/components/layout/content-shell";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { MERCHANT_LEGAL_INFO } from "@/lib/merchant";

export const metadata: Metadata = {
  title: "Uslovi kupovine",
  description:
    "Pravila kupovine, načini plaćanja, povraćaj i odustanak od ugovora — Svet Akcija.",
};

export default async function UsloviKupovinePage() {
  const cmsPage = await getCmsPage("uslovi-kupovine");
  if (cmsPage) {
    return (
      <>
        <div className="mx-auto w-full max-w-[var(--container-content)] px-6 pt-6">
          <Breadcrumbs trail={[{ label: cmsPage.title }]} />
        </div>
        <ContentHero title={cmsPage.title} lead={cmsPage.lead ?? undefined} />
        <ContentBody>{renderCmsMarkdown(cmsPage.bodyMarkdown)}</ContentBody>
      </>
    );
  }

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
            Prodavac je <strong>{MERCHANT_LEGAL_INFO.name}</strong>,{" "}
            {MERCHANT_LEGAL_INFO.address}, PIB {MERCHANT_LEGAL_INFO.pib}, MB{" "}
            {MERCHANT_LEGAL_INFO.registrationNumber}. Pretežna delatnost je
            trgovina na malo posredstvom pošte ili interneta, šifra delatnosti
            4791. Web adresa je www.svetpovoljnihcena.rs, kontakt telefon{" "}
            {MERCHANT_LEGAL_INFO.phone}, a kontakt e-pošta{" "}
            <Link href={`mailto:${MERCHANT_LEGAL_INFO.email}`}>
              {MERCHANT_LEGAL_INFO.email}
            </Link>
            . Svi ugovori zaključuju se na srpskom jeziku.
          </p>
        </ContentSection>

        <ContentSection id="cene" title="Cene i porezi">
          <p>
            Cene su izražene u dinarima i sadrže PDV. Akcijska cena je istaknuta
            crvenom bojom uz prethodnu najnižu cenu u poslednjih 30 dana, u
            skladu sa Zakonom o zaštiti potrošača.
          </p>
        </ContentSection>

        <ContentSection id="kartice" title="Načini plaćanja">
          <ul>
            <li>Platnim karticama (Visa, Mastercard, DinaCard) — WSPay 3D Secure.</li>
            <li>Raiffeisen IPS QR kodom, odvojeno od kartičnog plaćanja.</li>
            <li>Apple Pay i Google Pay kroz kartični WSPay tok kada su aktivni.</li>
            <li>Pouzeće — gotovinski ili karticom kod kurira.</li>
            <li>Uplatom na račun — predračun stiže e-poštom.</li>
          </ul>
        </ContentSection>

        <ContentSection id="dostava-ogranicenja" title="Dostava i ograničenja">
          <p>
            Načini, cene i rokovi isporuke prikazani su u checkout-u pre potvrde
            porudžbine i detaljno opisani na stranici{" "}
            <Link href="/uslovi-isporuke">Uslovi isporuke</Link>. Isporuka se
            vrši na teritoriji Republike Srbije; za izvoz, carinske propise i
            sva posebna ograničenja prodaje kupac mora prethodno kontaktirati
            podršku.
          </p>
        </ContentSection>

        <ContentSection id="ips" title="IPS plaćanje">
          <p>
            Nakon potvrde porudžbine preusmeravamo vas na Raiffeisen IPS stranu,
            gde se prikazuje IPS QR kod ili deep link za m-banking.
            Plaćanje je izvršeno tek kada od banke dobijemo potvrdu statusa.
          </p>
        </ContentSection>

        <ContentSection id="povracaj" title="Povraćaj sredstava">
          <p>
            U slučaju vraćanja robe i povraćaja sredstava kupcu koji je
            prethodno platio IPS Skeniraj metodom, bez obzira na razlog
            vraćanja, Svet Akcija d.o.o. je u obavezi da povraćaj vrši
            isključivo preko IPS sistema.
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

async function getCmsPage(slug: string) {
  if (!hasDatabaseConnection()) return null;
  if (!(await hasContentPageTable())) return null;
  try {
    return await db.contentPage.findFirst({
      where: { slug, published: true },
      select: { title: true, lead: true, bodyMarkdown: true },
    });
  } catch (error) {
    if (isMissingCmsSchema(error)) return null;
    console.error(`Failed to load CMS page "${slug}"`, error);
    return null;
  }
}

async function hasContentPageTable() {
  try {
    const rows = await db.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
          FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name = 'ContentPage'
      ) AS "exists"
    `;
    return rows[0]?.exists ?? false;
  } catch {
    return false;
  }
}

function isMissingCmsSchema(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ((error as { code?: string }).code === "P2021" ||
      (error as { code?: string }).code === "P2022")
  );
}

function renderCmsMarkdown(markdown: string) {
  const blocks = markdown
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks.map((block, index) => {
    if (block.startsWith("## ")) {
      const [heading, ...rest] = block.split("\n");
      const title = heading.replace(/^##\s+/, "").trim();
      return (
        <ContentSection key={index} id={slugify(title)} title={title}>
          {renderCmsMarkdown(rest.join("\n"))}
        </ContentSection>
      );
    }
    if (block.startsWith("- ")) {
      return (
        <ul key={index}>
          {block
            .split("\n")
            .map((line) => line.replace(/^-\s+/, "").trim())
            .filter(Boolean)
            .map((line, itemIndex) => (
              <li key={itemIndex}>{line}</li>
            ))}
        </ul>
      );
    }
    return <p key={index}>{block}</p>;
  });
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
