"use client";

import { Field } from "@/components/admin/field";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/admin/submit-button";

export function AdminError({ hasError }: { hasError: boolean }) {
  if (!hasError) return null;
  return (
    <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      Pogrešna e-pošta ili lozinka.
    </p>
  );
}

export function AdminLoginForm() {
  return (
    <>
      <Field label="E-pošta">
        <Input
          name="email"
          type="email"
          required
          autoComplete="email"
          autoFocus
        />
      </Field>
      <Field label="Lozinka">
        <Input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          minLength={8}
        />
      </Field>
      <SubmitButton className="w-full" pendingLabel="Prijava…">
        Prijavi se
      </SubmitButton>
    </>
  );
}
