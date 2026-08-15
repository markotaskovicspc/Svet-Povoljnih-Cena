export const OPEN_MOBILE_FILTERS_EVENT = "spc:open-mobile-filters";

const FILTERED_LISTING_ROUTES = new Set([
  "/akcija",
  "/heroji-meseca",
  "/nedeljna-akcija",
  "/niske-cene-pod-zastitom",
  "/novo",
  "/ogranicena-ponuda",
  "/outlet",
  "/specijalne-ponude",
  "/sve-do-999",
]);

export function mobileFilterHeaderEnabled(pathname: string) {
  return (
    FILTERED_LISTING_ROUTES.has(pathname) ||
    pathname.startsWith("/k/") ||
    pathname.startsWith("/kolekcija/") ||
    pathname.startsWith("/ponuda/")
  );
}
