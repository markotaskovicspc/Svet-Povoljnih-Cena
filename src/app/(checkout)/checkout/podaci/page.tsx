import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { CheckoutFlow } from "@/components/checkout/checkout-flow";
import { listAddresses } from "@/lib/api/addresses";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { EmailVerificationBanner } from "@/components/account/email-verification-banner";
import { getSmallParcelProvider } from "@/lib/mygls";
import { getCheckoutConfig } from "@/lib/checkout/config";

export const metadata: Metadata = {
  title: "Naplata — podaci za isporuku",
  description:
    "Bezbedna naplata u nekoliko koraka: identifikacija, podaci za isporuku, način isporuke, vaučer, plaćanje i potvrda.",
  robots: { index: false, follow: false },
};

export default async function CheckoutPodaciPage() {
  const user = await getCurrentUser();
  const account =
    user?.userType === "customer"
      ? await db.user.findUnique({
          where: { id: user.id },
          select: { email: true, emailVerified: true, name: true, firstName: true, lastName: true },
        })
      : null;
  const addresses =
    user?.userType === "customer"
      ? await listAddresses(user.id).catch(() => [])
      : [];
  const defaultAddress = addresses[0];
  const accountFullName = [account?.firstName, account?.lastName]
    .filter(Boolean)
    .join(" ");
  const accountName = account?.name ?? (accountFullName || null);
  const glsDeliveryPointsEnabled = getSmallParcelProvider() === "MYGLS";
  const checkoutConfig = await getCheckoutConfig();

  return (
    <div className="mx-auto max-w-[var(--container-page)] px-4 pt-3 pb-32 md:px-6 md:pt-4 md:pb-16">
      <Breadcrumbs
        trail={[
          { label: "Korpa", href: "/korpa" },
          { label: "Naplata" },
        ]}
      />
      <h1 className="font-display mt-2 text-2xl text-ink-900 md:text-4xl">
        Naplata
      </h1>
      <p className="mt-1 max-w-prose text-xs text-ink-500 md:text-sm">
        Sve što vam treba za bezbednu kupovinu — u jednom toku, bez odlaska sa
        stranice.
      </p>
      <div className="mt-3 md:mt-5">
        {account?.email && !account.emailVerified ? (
          <div className="mb-4">
            <EmailVerificationBanner email={account.email} />
          </div>
        ) : null}
        <CheckoutFlow
          checkoutConfig={checkoutConfig}
          glsDeliveryPointsEnabled={glsDeliveryPointsEnabled}
          initialCustomer={
            user?.userType === "customer"
              ? {
                  name: accountName ?? user.name ?? undefined,
                  email: account?.email ?? user.email ?? undefined,
                  authenticated: true,
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
