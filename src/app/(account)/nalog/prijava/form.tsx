"use client";

import { useFormStatus } from "react-dom";
import { LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type LoginErrorCode = "invalid" | "generic";

const loginErrorMessages: Record<LoginErrorCode, string> = {
  invalid: "Pogrešna e-pošta ili lozinka.",
  generic: "Prijava trenutno nije uspela. Pokušajte ponovo.",
};

export function LoginError({ error }: { error?: LoginErrorCode }) {
  if (!error) return null;
  return (
    <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {loginErrorMessages[error] ?? loginErrorMessages.generic}
    </p>
  );
}

export function CustomerLoginFields() {
  const { pending } = useFormStatus();

  return (
    <div className="space-y-4">
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
          autoComplete="current-password"
          minLength={8}
          className="h-11 bg-white"
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-ink-600">
        <input
          name="remember"
          type="checkbox"
          value="true"
          className="size-4 rounded border-border accent-brand-blue"
        />
        Zapamti me
      </label>
      <Button type="submit" disabled={pending} className="h-11 w-full gap-2">
        <LogIn className="size-4" aria-hidden />
        {pending ? "Prijava..." : "Prijavi se"}
      </Button>
    </div>
  );
}
