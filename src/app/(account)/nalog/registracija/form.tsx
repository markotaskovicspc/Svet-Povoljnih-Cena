"use client";

import { useFormStatus } from "react-dom";
import { UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type RegistrationErrorCode =
  | "email_taken"
  | "invalid_email"
  | "password_mismatch"
  | "weak_password"
  | "rate_limited"
  | "generic";

const errorMessages: Record<RegistrationErrorCode, string> = {
  email_taken: "Već postoji nalog za ovu e-poštu. Prijavite se ili koristite drugu adresu.",
  invalid_email: "Unesite ispravnu e-poštu.",
  password_mismatch: "Lozinke se ne poklapaju.",
  weak_password: "Lozinka mora imati najmanje 8 karaktera.",
  rate_limited: "Previše pokušaja registracije. Pokušajte ponovo kasnije.",
  generic: "Registracija trenutno nije uspela. Pokušajte ponovo.",
};

export function RegistrationError({
  error,
}: {
  error?: RegistrationErrorCode;
}) {
  if (!error) return null;

  return (
    <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {errorMessages[error] ?? errorMessages.generic}
    </p>
  );
}

export function CustomerRegistrationFields() {
  const { pending } = useFormStatus();

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="firstName">Ime</Label>
          <Input
            id="firstName"
            name="firstName"
            autoComplete="given-name"
            className="h-11 bg-white"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lastName">Prezime</Label>
          <Input
            id="lastName"
            name="lastName"
            autoComplete="family-name"
            className="h-11 bg-white"
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">E-pošta</Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          autoFocus
          placeholder="ime@primer.rs"
          className="h-11 bg-white"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Lozinka</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="new-password"
          minLength={8}
          maxLength={200}
          className="h-11 bg-white"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirmPassword">Potvrdite lozinku</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          required
          autoComplete="new-password"
          minLength={8}
          maxLength={200}
          className="h-11 bg-white"
        />
      </div>
      <label
        htmlFor="marketingEmailConsent"
        className="flex gap-3 rounded-lg border border-border/70 bg-muted-bg/50 p-3 text-sm leading-relaxed text-ink-700"
      >
        <input
          id="marketingEmailConsent"
          name="marketingEmailConsent"
          type="checkbox"
          value="true"
          className="mt-1 size-4 shrink-0 rounded border-input text-ink-900 accent-ink-900 focus-visible:ring-2 focus-visible:ring-walnut/40 focus-visible:outline-none"
        />
        <span>
          Želim promotivne mejlove, kupone i najbolje ponude. Mogu da se
          odjavim jednim klikom u svakom mejlu.
        </span>
      </label>
      <Button type="submit" disabled={pending} className="h-11 w-full gap-2">
        <UserPlus className="size-4" aria-hidden />
        {pending ? "Kreiranje naloga..." : "Kreiraj nalog"}
      </Button>
    </div>
  );
}
