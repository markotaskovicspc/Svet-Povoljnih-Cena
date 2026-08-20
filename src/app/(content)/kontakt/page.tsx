import type { Metadata } from "next";
import Link from "next/link";
import { Mail, MapPin } from "lucide-react";
import { CmsFunctionalPage } from "@/components/content/cms-content-page";
import { getFunctionalContentPage } from "@/lib/cms/pages";
import { MERCHANT_LEGAL_INFO } from "@/lib/merchant";

const SLUG = "kontakt";

export async function generateMetadata(): Promise<Metadata> {
  const page = await getFunctionalContentPage(SLUG);
  return {
    title: page.seoTitle ?? page.title,
    description: page.seoDescription,
    alternates: { canonical: `/${SLUG}` },
  };
}

const channels = [
  {
    icon: Mail,
    label: "E-pošta",
    value: MERCHANT_LEGAL_INFO.email,
    href: `mailto:${MERCHANT_LEGAL_INFO.email}`,
    note: `Za pitanja o porudžbinama, proizvodima i reklamacijama · ${MERCHANT_LEGAL_INFO.supportHours}`,
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
  ...(MERCHANT_LEGAL_INFO.returnsAddress
    ? [{
        icon: MapPin,
        label: "Povraćaj robe",
        value: MERCHANT_LEGAL_INFO.returnsAddress,
        href: `https://maps.google.com/?q=${encodeURIComponent(MERCHANT_LEGAL_INFO.returnsAddress)}`,
        note: `${MERCHANT_LEGAL_INFO.returnsContactName} · ${MERCHANT_LEGAL_INFO.returnsContactPhone}`,
      }]
    : []),
];

export default async function KontaktPage() {
  const page = await getFunctionalContentPage(SLUG);
  return (
    <CmsFunctionalPage page={page} widgetPosition="before">
      <ul className="not-prose grid gap-4 sm:grid-cols-2">
        {channels.map((channel) => (
          <li
            key={channel.label}
            className="bg-surface ring-border/60 rounded-2xl p-6 ring-1"
          >
            <div className="flex items-start gap-3">
              <span className="bg-muted-bg text-walnut grid size-10 place-items-center rounded-xl">
                <channel.icon className="size-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="font-mono text-[11px] tracking-[0.18em] text-ink-500 uppercase">
                  {channel.label}
                </p>
                <Link
                  href={channel.href}
                  className="font-display mt-1 block text-lg break-words text-ink-900 hover:text-walnut"
                >
                  {channel.value}
                </Link>
                <p className="mt-1 text-xs text-ink-500">{channel.note}</p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </CmsFunctionalPage>
  );
}
