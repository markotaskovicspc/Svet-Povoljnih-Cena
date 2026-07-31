"use client";

import { createContext, useContext } from "react";
import { useSession } from "next-auth/react";

const PricingEligibilityContext = createContext(false);

export function PricingEligibilityProvider({
  isCustomerLoggedIn,
  children,
}: {
  isCustomerLoggedIn?: boolean;
  children: React.ReactNode;
}) {
  const { data: session, status } = useSession();
  const sessionCustomer =
    status === "authenticated" && session.user?.userType === "customer";
  const eligible =
    status === "loading" ? Boolean(isCustomerLoggedIn) : sessionCustomer;

  return (
    <PricingEligibilityContext.Provider value={eligible}>
      {children}
    </PricingEligibilityContext.Provider>
  );
}

export function useLoyaltyEligibility() {
  return useContext(PricingEligibilityContext);
}
