import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { CheckoutFlow } from "@/components/checkout/checkout-flow";

export const metadata: Metadata = {
  title: "Naplata — podaci za isporuku",
  description:
    "Bezbedna naplata u nekoliko koraka: identifikacija, podaci za isporuku, način isporuke, vaučer, plaćanje i potvrda.",
  robots: { index: false, follow: false },
};

export default function CheckoutPodaciPage() {
  return (
    <div className="mx-auto max-w-[var(--container-page)] px-4 pt-6 pb-24 md:px-6">
      <Breadcrumbs
        trail={[
          { label: "Korpa", href: "/korpa" },
          { label: "Naplata" },
        ]}
      />
      <h1 className="font-display mt-3 text-3xl text-ink-900 md:text-4xl">
        Naplata
      </h1>
      <p className="mt-1 max-w-prose text-sm text-ink-500">
        Sve što vam treba za bezbednu kupovinu — u jednom toku, bez odlaska sa
        stranice.
      </p>
      <div className="mt-8">
        <CheckoutFlow />
      </div>
    </div>
  );
}
