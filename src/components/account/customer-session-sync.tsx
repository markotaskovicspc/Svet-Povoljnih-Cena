"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { getSession } from "next-auth/react";

import { shouldRefreshCustomerSession } from "@/lib/auth/customer-session-transition";

export function CustomerSessionSync() {
  const pathname = usePathname();
  const previousPathname = useRef(pathname);

  useEffect(() => {
    const previous = previousPathname.current;
    previousPathname.current = pathname;

    if (!shouldRefreshCustomerSession(previous, pathname)) return;

    // getSession broadcasts the fresh value to SessionProvider, including a
    // null session after logout. useSession().update() currently skips null.
    void getSession();
  }, [pathname]);

  return null;
}
