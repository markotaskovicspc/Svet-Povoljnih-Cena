"use client";

import { useState, useTransition } from "react";
import { getNewsletterBounces } from "@/app/admin/newsletter/kampanje/[id]/bounce-actions";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { newsletterCount } from "@/lib/newsletter/reporting";

type BouncePage = Awaited<ReturnType<typeof getNewsletterBounces>>;

export function NewsletterBounces({ campaignId, count }: { campaignId: string; count: number | null }) {
  const [page, setPage] = useState<BouncePage | null>(null);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();

  function load(afterId?: string) {
    setError(false);
    startTransition(async () => {
      try {
        const result = await getNewsletterBounces({ campaignId, afterId });
        setPage((previous) => ({
          items: afterId ? [...(previous?.items ?? []), ...result.items] : result.items,
          nextCursor: result.nextCursor,
        }));
      } catch {
        setError(true);
      }
    });
  }

  return (
    <Dialog onOpenChange={(open) => { if (open) { setPage(null); load(); } }}>
      <DialogTrigger className="cursor-pointer font-medium text-walnut underline underline-offset-4 hover:text-ink-900 focus-visible:outline-2 focus-visible:outline-offset-4" aria-label={`Prikaži odbijene email adrese (${newsletterCount(count)})`}>
        {newsletterCount(count)}
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader className="pr-8">
          <DialogTitle>Odbijene email adrese</DialogTitle>
          <DialogDescription>Primaoci ove kampanje za koje je evidentirana odbijena isporuka (bounce).</DialogDescription>
        </DialogHeader>
        <div aria-busy={pending} className="min-w-0 space-y-3">
          {page?.items.length ? (
            <ul className="max-h-[50dvh] divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {page.items.map((item) => (
                <li key={item.id} className="px-3 py-2">
                  <span className="block select-text break-all font-medium">{item.email}</span>
                  {item.bouncedAt ? <time dateTime={item.bouncedAt} className="text-xs text-ink-500">Odbijeno: {new Date(item.bouncedAt).toLocaleString("sr-Latn-RS", { timeZone: "Europe/Belgrade" })}</time> : null}
                </li>
              ))}
            </ul>
          ) : page && !pending ? <p>Nema evidentiranih odbijenih isporuka u ovoj kampanji.</p> : null}
          {pending ? <p role="status">Učitavam adrese…</p> : null}
          {error ? <div role="alert" className="space-y-2"><p>Lista nije učitana. Pokušajte ponovo.</p><Button variant="outline" disabled={pending} onClick={() => load(page?.nextCursor ?? undefined)}>Pokušaj ponovo</Button></div> : null}
          {page ? <p className="text-xs text-ink-500">Prikazano: {newsletterCount(page.items.length)}{page.nextCursor ? " · ima još adresa" : " · sve odbijene adrese"}</p> : null}
          {page?.nextCursor && !error ? <Button variant="outline" disabled={pending} onClick={() => load(page.nextCursor!)}>Prikaži još</Button> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
