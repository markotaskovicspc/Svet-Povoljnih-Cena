"use client";

import Link from "next/link";
import { CheckCircle2, Mail, ArrowRight } from "lucide-react";
import { useCart } from "@/lib/hooks/use-cart";
import { useGuestLoyalty } from "@/lib/loyalty/use-guest-loyalty";

export default function LoyaltyConfirmationPage() {
  const member = useGuestLoyalty();
  const hasCart = useCart((state) => state.hydrated && state.lines.length > 0);
  return <main className="mx-auto max-w-xl px-5 py-16 sm:py-24">
    <div className="rounded-2xl border border-border bg-white p-7 text-center shadow-soft-2 sm:p-10" role="status">
      {member.email ? <CheckCircle2 className="mx-auto mb-6 size-14 text-success" aria-hidden /> : <Mail className="mx-auto mb-6 size-14 text-action" aria-hidden />}
      <p className="text-xs font-semibold tracking-[0.18em] text-ink-500">SPC LOYALTY</p>
      <h1 className="mt-3 text-2xl font-semibold text-ink-900">{!member.ready ? "Proveravamo potvrdu…" : member.email ? "Mejl je potvrđen!" : "Proverite link za potvrdu"}</h1>
      <p className="mt-4 text-sm leading-6 text-ink-700">{member.email
        ? "Vaše loyalty pogodnosti su aktivne i u pregledaču iz kog ste zatražili potvrdu."
        : member.ready ? "Link je istekao, već je iskorišćen ili potvrda nije uspela. Vratite se u korpu iz koje ste poslali zahtev: ako pogodnosti nisu aktivne, zatražite novi link." : "Sačekajte trenutak."}</p>
      {member.email && !hasCart && <div className="mt-6 rounded-xl bg-muted-bg p-5 text-left text-sm leading-6 text-ink-700"><strong className="text-ink-900">Kupovinu ste započeli u drugom pregledaču?</strong><p className="mt-2">Vratite se na otvorenu korpu u tom pregledaču. Artikli su tamo sačuvani, a popusti će se automatski obračunati. Ovaj prozor možete zatvoriti.</p></div>}
      {member.ready && <Link href={hasCart ? "/korpa" : "/"} className="mt-7 inline-flex items-center justify-center gap-2 rounded-lg bg-ink-900 px-6 py-3.5 text-sm font-semibold text-white hover:bg-walnut">{hasCart ? "Nastavi u mojoj korpi" : "Otvori prodavnicu ovde"}<ArrowRight className="size-4" aria-hidden /></Link>}
    </div>
  </main>;
}
