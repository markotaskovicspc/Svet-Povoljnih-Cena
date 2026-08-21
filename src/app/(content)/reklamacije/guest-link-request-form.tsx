"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function GuestReclamationLinkRequestForm({
  defaultOrderNumber = "",
}: {
  defaultOrderNumber?: string;
}) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("sending");
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/reclamations/guest-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderNumber: String(data.get("orderNumber") ?? ""),
        email: String(data.get("email") ?? ""),
      }),
    }).catch(() => null);
    setState(response?.ok ? "sent" : "error");
  }

  return (
    <section
      id="kupovina-bez-naloga"
      className="mt-10 scroll-mt-28 rounded-2xl border border-border/70 bg-muted-bg/50 p-5 md:p-6"
    >
      <h2 className="font-display text-2xl font-bold text-brand-blue">
        Kupili ste bez naloga?
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-ink-600">
        Bezbedan link se nalazi u potvrdi porudžbine. Ako poruku više nemate,
        unesite broj isporučene porudžbine i istu e-poštu koju ste koristili pri
        kupovini.
      </p>

      {state === "sent" ? (
        <p
          role="status"
          className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"
        >
          Ako se podaci poklapaju sa isporučenom porudžbinom kupljenom bez
          naloga, poslali smo novi bezbedan link. Proverite i neželjenu poštu.
        </p>
      ) : (
        <form onSubmit={submit} className="mt-5 grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="guest-reclamation-order">Broj porudžbine</Label>
            <Input
              id="guest-reclamation-order"
              name="orderNumber"
              defaultValue={defaultOrderNumber}
              autoComplete="off"
              placeholder="SPC-2026-..."
              required
              minLength={3}
              maxLength={80}
              className="bg-white"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="guest-reclamation-email">E-pošta iz porudžbine</Label>
            <Input
              id="guest-reclamation-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="bg-white"
            />
          </div>
          {state === "error" ? (
            <p role="alert" className="text-sm text-destructive">
              Zahtev trenutno nije moguće poslati ili je poslato previše
              zahteva. Pokušajte kasnije.
            </p>
          ) : null}
          <Button
            type="submit"
            size="lg"
            className="w-full md:w-auto"
            disabled={state === "sending"}
          >
            {state === "sending" ? "Slanje..." : "Pošalji bezbedan link"}
          </Button>
          <p className="text-xs leading-relaxed text-ink-500">
            Iz bezbednosnih razloga prikazujemo isti odgovor i kada podaci ne
            odgovaraju nijednoj porudžbini.
          </p>
        </form>
      )}
    </section>
  );
}
