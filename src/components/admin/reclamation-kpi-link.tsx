"use client";

import Link from "next/link";

/** Link na pogled dnevnika; briše zapamćeno stanje tabele za taj pogled da se uvek otvori čist filter. */
export function ReclamationKpiLink({ href, className, title, children }: {
  href: string;
  className?: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      title={title}
      className={className}
      onClick={() => {
        try {
          sessionStorage.removeItem(`spc:grid-navigation:reklamacije-dnevnik:${href}`);
        } catch { /* Link radi i bez sessionStorage. */ }
      }}
    >
      {children}
    </Link>
  );
}
