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
    `Kontakt podaci i podaci o trgovcu — ${BRAND.name}.`,
};

const channels = [
  ...(MERCHANT_LEGAL_INFO.phone
    ? [{
        icon: Phone,
        label: "Telefon",
        value: MERCHANT_LEGAL_INFO.phone,
        href: `tel:${MERCHANT_LEGAL_INFO.phone.replace(/\s/g, "")}`,
        note: MERCHANT_LEGAL_INFO.supportHours ?? "Radno vreme biće objavljeno nakon potvrde.",
      }]
    : []),
  ...(MERCHANT_LEGAL_INFO.viber
    ? [{
        icon: MessageSquare,
        label: "Viber",
        value: MERCHANT_LEGAL_INFO.viber,
        href: `viber://chat?number=${encodeURIComponent(MERCHANT_LEGAL_INFO.viber.replace(/\s/g, ""))}`,
        note: MERCHANT_LEGAL_INFO.supportHours ?? "Odgovaramo u okviru objavljenog radnog vremena.",
      }]
    : []),
  {
    icon: Mail,
    label: "E-pošta",
    value: MERCHANT_LEGAL_INFO.email,
    href: `mailto:${MERCHANT_LEGAL_INFO.email}`,
    note: "Za pitanja o porudžbinama, proizvodima i reklamacijama",
  },
  {
    icon: MapPin,
    label: "Sedište trgovca",
    value: MERCHANT_LEGAL_INFO.shortAddress,
    href: "https://maps.google.com/?q=Vojvođanska+401+Beograd",
    note: "Ovo nije mesto za preuzimanje bez prethodne potvrde",
  },
  ...(MERCHANT_LEGAL_INFO.warehouseAddress
    ? [{
        icon: MapPin,
        label: "Skladište / preuzimanje",
        value: MERCHANT_LEGAL_INFO.warehouseAddress,
        href: `https://maps.google.com/?q=${encodeURIComponent(MERCHANT_LEGAL_INFO.warehouseAddress)}`,
        note: "Dolazak isključivo nakon potvrde podrške",
      }]
    : []),
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
        lead="Za pitanja o proizvodima, porudžbinama i reklamacijama koristite potvrđene kanale ispod."
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
