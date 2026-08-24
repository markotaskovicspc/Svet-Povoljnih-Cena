import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { CheckoutFlow } from "@/components/checkout/checkout-flow";
import { listAddresses } from "@/lib/api/addresses";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { EmailVerificationBanner } from "@/components/account/email-verification-banner";
import { getCheckoutConfig } from "@/lib/checkout/config";
import { CheckoutStartedAnalytics } from "@/components/analytics/first-party-analytics";
import { getConfiguredSocialAuthProviders } from "@/lib/auth/social-providers";
import { appleAction, facebookAction, googleAction } from "@/app/(account)/nalog/auth-actions";
import {
  loginCustomerAction,
  registerCustomerAction,
} from "@/app/(account)/nalog/customer-auth-actions";
import type { LoginErrorCode } from "@/app/(account)/nalog/prijava/form";
import type { RegistrationErrorCode } from "@/app/(account)/nalog/registracija/form";

export const metadata: Metadata = {
  title: "Završetak porudžbine",
  description:
    "Podaci za isporuku, način dostave, vaučer, plaćanje i potvrda porudžbine u jednom toku.",
  robots: { index: false, follow: false },
};

export default async function CheckoutPodaciPage({
  searchParams,
}: {
  searchParams: Promise<{ auth?: string; authError?: string }>;
}) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const account =
    user?.userType === "customer"
      ? await db.user.findUnique({
          where: { id: user.id },
          select: {
            email: true,
            emailVerified: true,
            name: true,
            firstName: true,
            lastName: true,
          },
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
  // Paket Shop/locker delivery is intentionally paused until MyGLS confirms
  // the account services and delivery-point master-data feed.
  const glsDeliveryPointsEnabled = false;
  // A structured X Express address is collected for every courier order.
  // MyGLS can use the same human-readable address, while a later X Express
  // route would otherwise be blocked by missing provider town/street IDs.
  const xExpressAddressEnabled = true;
  const checkoutConfig = await getCheckoutConfig();
  const socialProviders = getConfiguredSocialAuthProviders(
    {
      google: googleAction,
      facebook: facebookAction,
      apple: appleAction,
    },
    { includeUnavailable: true },
  );
  const initialAuthIntent = checkoutAuthIntent(sp.auth);
  const loginError =
    initialAuthIntent === "login" ? checkoutLoginError(sp.authError) : undefined;
  const registrationError =
    initialAuthIntent === "register"
      ? checkoutRegistrationError(sp.authError)
      : undefined;

  return (
    <div className="mx-auto max-w-[var(--container-page)] px-4 pt-3 pb-32 md:px-6 md:pt-4 md:pb-16">
      <CheckoutStartedAnalytics />
      <Breadcrumbs
        trail={[
          { label: "Korpa", href: "/korpa" },
          { label: "Završetak porudžbine" },
        ]}
      />
      <h1 className="font-display mt-2 text-2xl text-ink-900 md:text-4xl">
        Završetak porudžbine
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
          xExpressAddressEnabled={xExpressAddressEnabled}
          socialAuthProviders={socialProviders}
          loginAction={loginCustomerAction}
          registrationAction={registerCustomerAction}
          initialAuthIntent={initialAuthIntent}
          loginError={loginError}
          registrationError={registrationError}
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
                        xExpressTownId:
                          defaultAddress.xExpressTownId ?? undefined,
                        xExpressStreetId:
                          defaultAddress.xExpressStreetId ?? undefined,
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

function checkoutAuthIntent(value?: string) {
  return value === "login" || value === "register" ? value : undefined;
}

function checkoutLoginError(value?: string): LoginErrorCode | undefined {
  return value === "invalid" || value === "generic" ? value : undefined;
}

function checkoutRegistrationError(
  value?: string,
): RegistrationErrorCode | undefined {
  return value === "email_taken" ||
    value === "invalid_email" ||
    value === "weak_password" ||
    value === "rate_limited" ||
    value === "generic"
    ? value
    : undefined;
}
