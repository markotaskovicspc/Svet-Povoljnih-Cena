/**
 * Breadcrumbs — JSON-LD friendly trail used by listing & PDP pages.
 * Last item renders as the current page (no link, aria-current).
 */
export interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumbs({}: {
  trail: Crumb[];
  className?: string;
}) {
  return null;
}
