"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("[ui-error]", error.digest ?? error.name); }, [error]);
  return <div className="mx-auto max-w-xl px-6 py-20 text-center"><h1 className="font-display text-4xl">Nešto nije uspelo</h1><p className="mt-3 text-ink-600">Pokušajte ponovo. Ako se problem nastavi, kontaktirajte podršku.</p><Button className="mt-6" onClick={reset}>Pokušaj ponovo</Button></div>;
}
