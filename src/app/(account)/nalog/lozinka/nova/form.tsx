"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function NewPasswordFields() {
  const { pending } = useFormStatus();
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="password">Nova lozinka</Label>
        <Input id="password" name="password" type="password" minLength={8} maxLength={200} autoComplete="new-password" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirmPassword">Potvrdite novu lozinku</Label>
        <Input id="confirmPassword" name="confirmPassword" type="password" minLength={8} maxLength={200} autoComplete="new-password" required />
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Čuvanje..." : "Sačuvaj novu lozinku"}
      </Button>
    </div>
  );
}
