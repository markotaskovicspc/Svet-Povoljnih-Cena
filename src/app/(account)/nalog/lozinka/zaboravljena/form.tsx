"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function PasswordResetRequestForm() {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("sending");
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/password-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: String(data.get("email") ?? "") }),
    }).catch(() => null);
    setState(response?.ok ? "sent" : "error");
  }

  if (state === "sent") {
    return (
      <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        Ako nalog postoji, poslali smo link za postavljanje nove lozinke. Proverite i neželjenu poštu.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="reset-email">E-pošta naloga</Label>
        <Input id="reset-email" name="email" type="email" autoComplete="email" required autoFocus />
      </div>
      {state === "error" ? (
        <p role="alert" className="text-sm text-destructive">
          Zahtev trenutno nije moguće poslati ili je poslato previše zahteva. Pokušajte kasnije.
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={state === "sending"}>
        {state === "sending" ? "Slanje..." : "Pošalji link"}
      </Button>
    </form>
  );
}
