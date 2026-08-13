"use client";

import { createContext, useContext, useSyncExternalStore } from "react";
import { useSession } from "next-auth/react";

const PricingEligibilityContext = createContext(false);
const subscribeToClientRuntime = () => () => undefined;

export function resolvePricingEligibility({
  clientReady,
  isCustomerLoggedIn,
  sessionStatus,
  sessionUserType,
}: {
  clientReady: boolean;
  isCustomerLoggedIn?: boolean;
  sessionStatus: "authenticated" | "loading" | "unauthenticated";
  sessionUserType?: string;
}) {
  if (!clientReady || sessionStatus === "loading") {
    return Boolean(isCustomerLoggedIn);
  }

  return sessionStatus === "authenticated" && sessionUserType === "customer";
}

export function PricingEligibilityProvider({
  isCustomerLoggedIn,
  children,
}: {
  isCustomerLoggedIn?: boolean;
  children: React.ReactNode;
}) {
  const { data: session, status } = useSession();
  const clientReady = useSyncExternalStore(
    subscribeToClientRuntime,
    () => true,
    () => false,
  );
  const eligible = resolvePricingEligibility({
    clientReady,
    isCustomerLoggedIn,
    sessionStatus: status,
    sessionUserType: session?.user?.userType,
  });

  return (
    <PricingEligibilityContext.Provider value={eligible}>
      {children}
    </PricingEligibilityContext.Provider>
  );
}

export function useLoyaltyEligibility() {
  return useContext(PricingEligibilityContext);
}
