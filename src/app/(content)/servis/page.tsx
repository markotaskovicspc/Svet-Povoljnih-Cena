import type { Metadata } from "next";
import {
  ContentBody,
  ContentHero,
  HubCard,
} from "@/components/layout/content-shell";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";

export const metadata: Metadata = {
  title: "Servis za kupce",
  description:
    "Hub stranice za pomoć — reklamacije, uslovi kupovine, komentari i sugestije.",
};

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

export default function ServisPage() {
  return (
    <>
      <div className="mx-auto w-full max-w-[var(--container-content)] px-6 pt-6">
        <Breadcrumbs trail={[{ label: "Servis za kupce" }]} />
      </div>
      <ContentHero
        eyebrow="Pomoć posle kupovine"
        title="Servis za kupce."
        lead="Sve što vam može zatrebati posle porudžbine — od reklamacija do brze podrške."
      />
      <ContentBody>
        <ul className="not-prose grid gap-4 sm:grid-cols-2">
          {hubs.map((h) => (
            <li key={h.href}>
              <HubCard {...h} />
            </li>
          ))}
        </ul>
      </ContentBody>
    </>
  );
}
