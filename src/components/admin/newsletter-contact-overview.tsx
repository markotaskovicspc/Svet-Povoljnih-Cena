import type { NewsletterContactOverview as ContactOverview } from "@/lib/newsletter/contact-overview";
import { StatCard } from "@/components/admin/card";

export function NewsletterContactOverview({ counts }: { counts: ContactOverview }) {
  const number = (value: number) => value.toLocaleString("sr-Latn-RS");
  return (
    <section aria-label="Ukupni kontakti i newsletter saglasnosti" className="space-y-3">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Svi email kontakti" value={number(counts.total)} hint="Jedinstvene adrese iz svih izvora, sa i bez saglasnosti." />
        <StatCard label="Sa aktivnom saglasnošću" value={number(counts.activeConsent)} hint="Potvrđene aktivne prijave u newsletter evidenciji." tone="success" />
        <StatCard label="Bez aktivne saglasnosti" value={number(counts.withoutActiveConsent)} hint="Nisu aktivno prijavljeni u newsletter evidenciji; ne uključuju se u slanje." />
        <StatCard label="Dostupni za newsletter" value={number(counts.eligible)} hint="Aktivne prijave bez blokade slanja. Izabrane grupe i ograničenja kampanje mogu smanjiti ovaj broj." tone="success" />
      </div>
      <p className="text-xs text-ink-500">
        Ukupno obuhvata naloge korisnika, kupce iz ERP-a, emailove iz porudžbina i checkouta, newsletter prijave i uvezene custom liste.
        Ista email adresa broji se jednom, i kada se pojavljuje u više grupa. Kupovina ili registracija sama po sebi ne daje saglasnost za marketing.
      </p>
      {counts.legacyConsentMissingContact > 0 ? (
        <p role="status" className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm">
          {number(counts.legacyConsentMissingContact)} adresa ima ranije evidentiranu prijavu, ali nema kontakt u newsletter evidenciji.
          Potrebna je provera prenosa u Podešavanjima; ove adrese još nisu uključene u broj dostupnih primalaca.
        </p>
      ) : null}
    </section>
  );
}
