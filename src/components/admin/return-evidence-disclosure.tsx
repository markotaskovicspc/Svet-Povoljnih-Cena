"use client";

import Link from "next/link";
import { useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

/** The warehouse scanner must not load the full return ledger until requested. */
export function ReturnEvidenceDisclosure({ loaded, href, children }: { loaded: boolean; href: string; children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <details open={loaded} onToggle={event => {
    if (event.currentTarget.open && !loaded && !pending) startTransition(() => router.push(href, { scroll: false }));
  }}>
    <summary className="cursor-pointer py-3 font-medium">Evidencija povrata i ručna provera</summary>
    {loaded ? children : <p role="status" className="py-3 text-sm text-ink-500">{pending ? "Učitavam evidenciju povrata…" : <Link href={href} prefetch={false}>Učitaj evidenciju povrata</Link>}</p>}
  </details>;
}
