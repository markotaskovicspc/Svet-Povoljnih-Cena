import type { Metadata } from "next";
import Link from "next/link";
import { Mail, MapPin, MessageSquare, Phone } from "lucide-react";
import {
  ContentBody,
  ContentHero,
  ContentSection,
} from "@/components/layout/content-shell";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { BRAND } from "@/lib/brand";
import { MERCHANT_LEGAL_INFO } from "@/lib/merchant";

export const metadata: Metadata = {
  title: "Kontakt",
  description:
    `Kontaktirajte ${BRAND.name} tim — telefon, e-pošta, radno vreme, Viber i adresa skladišta.`,
};

const channels = [
  {
    icon: Phone,
    label: "Telefon",
    value: "+381 11 4444 555",
    href: "tel:+381114444555",
    note: "Pon–Sub 09:00–20:00",
  },
  {
    icon: MessageSquare,
    label: "Viber & WhatsApp",
    value: "+381 64 4444 555",
    href: "viber://chat?number=%2B381644444555",
    note: "Najbrži odgovor u toku dana",
  },
  {
    icon: Mail,
    label: "E-pošta",
    value: "podrska@svetpovoljnihcena.rs",
    href: "mailto:podrska@svetpovoljnihcena.rs",
    note: "Odgovor u roku od 24h radnim danima",
  },
  {
    icon: MapPin,
    label: "Skladište i pickup",
    value: "Beograd, Vojvođanska 401",
    href: "https://maps.google.com/?q=Vojvođanska+401+Beograd",
    note: "Pon–Pet 08:00–16:00",
  },
];

export default function KontaktPage() {
  return (
    <>
      <div className="mx-auto w-full max-w-[var(--container-content)] px-6 pt-6">
        <Breadcrumbs trail={[{ label: "Kontakt" }]} />
      </div>
      <ContentHero
        eyebrow="Tu smo za vas"
        title="Razgovarajmo."
        lead="Saveti pri izboru, status porudžbine, montaža, reklamacije — javite se na bilo koji od kanala ispod. Trudimo se da odgovorimo isti dan."
      />
      <ContentBody>
        <ul className="not-prose grid gap-4 sm:grid-cols-2">
          {channels.map((c) => (
            <li
              key={c.label}
              className="bg-surface ring-border/60 rounded-2xl p-6 ring-1"
            >
              <div className="flex items-start gap-3">
                <span className="bg-muted-bg text-walnut grid size-10 place-items-center rounded-xl">
                  <c.icon className="size-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="font-mono text-[11px] tracking-[0.18em] text-ink-500 uppercase">
                    {c.label}
                  </p>
                  <Link
                    href={c.href}
                    className="font-display mt-1 block text-lg break-words text-ink-900 hover:text-walnut"
                  >
                    {c.value}
                  </Link>
                  <p className="mt-1 text-xs text-ink-500">{c.note}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>

        <ContentSection id="firma" title="Podaci o firmi">
          <p>
            <strong>{MERCHANT_LEGAL_INFO.name}</strong> —{" "}
            {MERCHANT_LEGAL_INFO.address}. PIB {MERCHANT_LEGAL_INFO.pib},
            matični broj {MERCHANT_LEGAL_INFO.registrationNumber}. Tekući račun{" "}
            {MERCHANT_LEGAL_INFO.bankAccount} ({MERCHANT_LEGAL_INFO.bankName}).
          </p>
        </ContentSection>

        <ContentSection id="medii" title="Mediji i saradnja">
          <p>
            Za marketing, sadržaj i partnerstva pišite na{" "}
            <Link href="mailto:marketing@svetpovoljnihcena.rs">
              marketing@svetpovoljnihcena.rs
            </Link>
            . Za nabavku i veleprodaju —{" "}
            <Link href="mailto:b2b@svetpovoljnihcena.rs">
              b2b@svetpovoljnihcena.rs
            </Link>
            .
          </p>
        </ContentSection>
      </ContentBody>
    </>
  );
}
