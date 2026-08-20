import type { Metadata } from "next";
import { CmsFunctionalPage } from "@/components/content/cms-content-page";
import { HubCard } from "@/components/layout/content-shell";
import { getFunctionalContentPage } from "@/lib/cms/pages";

const SLUG = "servis";

export async function generateMetadata(): Promise<Metadata> {
  const page = await getFunctionalContentPage(SLUG);
  return {
    title: page.seoTitle ?? page.title,
    description: page.seoDescription,
    alternates: { canonical: `/${SLUG}` },
  };
}

const hubs = [
  {
    href: "/reklamacije",
    title: "Reklamacije",
    description:
      "Prijavite oštećenje, neispravan artikal ili nedostatak iz isporuke. Odgovor u roku od 8 dana.",
  },
  {
    href: "/uslovi-kupovine",
    title: "Uslovi kupovine",
    description:
      "Kompletni uslovi — cene, načini plaćanja, pravo na odustanak i garancija saobraznosti.",
  },
  {
    href: "/komentari",
    title: "Komentari i sugestije",
    description:
      "Imate ideju kako da budemo bolji? Recite nam — čitamo svaku poruku.",
  },
  {
    href: "/uslovi-isporuke",
    title: "Uslovi isporuke",
    description:
      "Rokovi, cene dostave i pravila preuzimanja sa kurirskim i kamionskim transportom.",
  },
  {
    href: "/pomoc",
    title: "Često pitanja",
    description:
      "Najbrži odgovori na pitanja o porudžbini, plaćanju, nalogu i isporuci.",
  },
  {
    href: "/kontakt",
    title: "Direktan kontakt",
    description:
      "Telefon, e-pošta, Viber — sve linije podrške na jednom mestu.",
  },
];

export default async function ServisPage() {
  const page = await getFunctionalContentPage(SLUG);
  return (
    <CmsFunctionalPage page={page}>
      <ul className="not-prose mt-8 grid gap-4 sm:grid-cols-2">
        {hubs.map((hub) => (
          <li key={hub.href}>
            <HubCard {...hub} />
          </li>
        ))}
      </ul>
    </CmsFunctionalPage>
  );
}
