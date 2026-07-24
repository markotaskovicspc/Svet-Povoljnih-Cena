"use client";

import { createContext, useContext } from "react";

const PricingEligibilityContext = createContext(false);

export function PricingEligibilityProvider({
  isCustomerLoggedIn,
  children,
}: {
  isCustomerLoggedIn: boolean;
  children: React.ReactNode;
}) {
  return (
    <PricingEligibilityContext.Provider value={isCustomerLoggedIn}>
      {children}
    </PricingEligibilityContext.Provider>
  );
}

export function useLoyaltyEligibility() {
  return useContext(PricingEligibilityContext);
}
