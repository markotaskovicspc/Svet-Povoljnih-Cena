import type { Metadata } from "next";
import Link from "next/link";
import {
  Heart,
  LifeBuoy,
  LogOut,
  PackageCheck,
  ShoppingBag,
  User2,
} from "lucide-react";
import { signOut } from "@/lib/auth/auth";
import { requireUser } from "@/lib/auth/session";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Moj nalog",
  description: "Pregled vašeg naloga, liste želja i kupovine.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

async function signOutAction() {
  "use server";
  await signOut({ redirectTo: "/nalog/prijava" });
}

const quickLinks = [
  {
    href: "/nalog/lista-zelja",
    title: "Lista želja",
    description: "Pogledajte sačuvane proizvode i favorite.",
    icon: Heart,
  },
  {
    href: "/korpa",
    title: "Korpa",
    description: "Nastavite kupovinu ili završite porudžbinu.",
    icon: ShoppingBag,
  },
  {
    href: "/servis",
    title: "Podrška",
    description: "Pomoć za porudžbine, reklamacije i isporuku.",
    icon: LifeBuoy,
  },
];

export default async function AccountPage() {
  const user = await requireUser("/nalog");
  const displayName = user.name ?? user.email ?? "Kupac";

  return (
    <div className="mx-auto w-full max-w-[var(--container-page)] px-4 py-10 md:px-6 md:py-14">
      <div className="flex flex-col gap-6 border-b border-border/70 pb-8 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-walnut">
            Moj nalog
          </p>
          <h1 className="font-display mt-3 text-4xl text-ink-900 md:text-5xl">
            Dobro došli, {displayName}
          </h1>
          <p className="mt-3 max-w-[60ch] text-sm leading-relaxed text-ink-600">
            Odavde možete nastaviti kupovinu, otvoriti listu želja i brzo
            pronaći podršku za postojeće porudžbine.
          </p>
        </div>
        <form action={signOutAction}>
          <Button type="submit" variant="outline" className="gap-2">
            <LogOut className="size-4" aria-hidden />
            Odjava
          </Button>
        </form>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {quickLinks.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="group rounded-lg border border-border/70 bg-surface p-5 transition hover:border-walnut/50 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-walnut/40 focus-visible:outline-none"
            >
              <Icon className="size-5 text-walnut" aria-hidden />
              <h2 className="font-display mt-4 text-xl text-ink-900">
                {item.title}
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-ink-600">
                {item.description}
              </p>
              <span className="mt-4 inline-flex text-sm font-medium text-walnut group-hover:underline">
                Otvori
              </span>
            </Link>
          );
        })}
      </div>

      <section className="mt-8 rounded-lg border border-border/70 bg-muted-bg/50 p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <PackageCheck className="mt-0.5 size-5 text-walnut" aria-hidden />
            <div>
              <h2 className="font-display text-xl text-ink-900">
                Porudžbine stižu uskoro u nalog
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-ink-600">
                Dok se istorija porudžbina povezuje, potvrde i statusi stižu na
                e-poštu koju koristite pri kupovini.
              </p>
            </div>
          </div>
          <Link
            href="/checkout"
            className={cn(buttonVariants({ variant: "default", size: "lg" }), "gap-2")}
          >
            <User2 className="size-4" aria-hidden />
            Nastavi kupovinu
          </Link>
        </div>
      </section>
    </div>
  );
}
