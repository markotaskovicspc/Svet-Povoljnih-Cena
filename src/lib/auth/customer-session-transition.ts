const CUSTOMER_AUTH_ENTRY_PATHS = new Set([
  "/nalog/prijava",
  "/nalog/registracija",
]);

/**
 * Server-action auth redirects keep the root client providers mounted. Refresh
 * the client session after those transitions so navigation, loyalty pricing,
 * and commerce sync immediately observe the new authentication state.
 */
export function shouldRefreshCustomerSession(
  previousPathname: string,
  pathname: string,
): boolean {
  if (previousPathname === pathname) return false;
  if (CUSTOMER_AUTH_ENTRY_PATHS.has(previousPathname)) return true;

  // Covers account sign-out and redirects caused by an invalidated session.
  return (
    pathname === "/nalog/prijava" && previousPathname.startsWith("/nalog")
  );
}
