import type { Metadata } from "next";
import Link from "next/link";
import { PasswordResetRequestForm } from "./form";

export const metadata: Metadata = {
  title: "Zaboravljena lozinka",
  robots: { index: false, follow: false },
};

export default function ForgottenPasswordPage() {
  return (
    <div className="mx-auto w-full max-w-lg px-4 py-12 md:py-20">
      <section className="rounded-2xl border border-border/70 bg-surface p-6 shadow-sm md:p-8">
        <h1 className="font-display text-3xl text-ink-900">Postavite novu lozinku</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-600">
          Unesite e-poštu naloga. Iz bezbednosnih razloga uvek prikazujemo isti odgovor.
        </p>
        <div className="mt-6"><PasswordResetRequestForm /></div>
        <Link href="/nalog/prijava" className="mt-5 inline-flex text-sm font-medium text-walnut hover:underline">
          Nazad na prijavu
        </Link>
      </section>
    </div>
  );
}
