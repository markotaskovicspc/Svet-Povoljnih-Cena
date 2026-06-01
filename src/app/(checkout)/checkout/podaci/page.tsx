import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { CheckoutFlow } from "@/components/checkout/checkout-flow";
import { listAddresses } from "@/lib/api/addresses";
import { getCurrentUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Naplata — podaci za isporuku",
  description:
    "Bezbedna naplata u nekoliko koraka: identifikacija, podaci za isporuku, način isporuke, vaučer, plaćanje i potvrda.",
  robots: { index: false, follow: false },
};

export default async function CheckoutPodaciPage() {
  const user = await getCurrentUser();
  const addresses =
    user?.userType === "customer"
      ? await listAddresses(user.id).catch(() => [])
      : [];
  const defaultAddress = addresses[0];

  return (
    <div className="mx-auto max-w-[var(--container-page)] px-4 pt-4 pb-36 md:px-6 md:pt-6 md:pb-24">
      <Breadcrumbs
        trail={[
          { label: "Korpa", href: "/korpa" },
          { label: "Naplata" },
        ]}
      />
      <h1 className="font-display mt-3 text-2xl text-ink-900 md:text-4xl">
        Naplata
      </h1>
      <p className="mt-1 max-w-prose text-xs text-ink-500 md:text-sm">
        Sve što vam treba za bezbednu kupovinu — u jednom toku, bez odlaska sa
        stranice.
      </p>
      <div className="mt-4 md:mt-8">
        <CheckoutFlow
          initialCustomer={
            user?.userType === "customer"
              ? {
                  name: user.name ?? undefined,
                  email: user.email ?? undefined,
                  address: defaultAddress
                    ? {
                        firstName: defaultAddress.firstName,
                        lastName: defaultAddress.lastName,
                        phone: defaultAddress.phone,
                        street: defaultAddress.street,
                        city: defaultAddress.city,
                        postalCode: defaultAddress.postalCode,
                        country: defaultAddress.country,
                        companyName: defaultAddress.companyName ?? undefined,
                        pib: defaultAddress.pib ?? undefined,
                      }
                    : undefined,
                }
              : undefined
          }
        />
      </div>
    </div>
  );
}
