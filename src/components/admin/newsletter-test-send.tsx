"use client";

import { useEffect, useState } from "react";
import type { AdminActionState } from "@/lib/admin/action-state";
import { AdminActionForm } from "./action-form";
import { Field } from "./field";
import { SubmitButton } from "./submit-button";
import { Input } from "@/components/ui/input";

export function NewsletterTestSend({ campaignId, savedVersion, email, action }: {
  campaignId: string;
  savedVersion: string;
  email: string;
  action: (state: AdminActionState, form: FormData) => Promise<AdminActionState>;
}) {
  const [recipientMode, setRecipientMode] = useState(email ? "mine" : "custom");
  const [customEmail, setCustomEmail] = useState("");
  const recipientEmail = recipientMode === "mine" ? email : customEmail;
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    const editor = document.getElementById("newsletter-campaign-editor");
    const changed = () => setDirty(true);
    editor?.addEventListener("input", changed);
    editor?.addEventListener("change", changed);
    editor?.addEventListener("drop", changed);
    // Adding, removing or moving a content block also changes the saved message.
    const clicked = (event: Event) => {
      if ((event.target as Element).closest('button[type="button"]')) changed();
    };
    editor?.addEventListener("click", clicked);
    return () => {
      editor?.removeEventListener("input", changed);
      editor?.removeEventListener("change", changed);
      editor?.removeEventListener("drop", changed);
      editor?.removeEventListener("click", clicked);
    };
  }, []);
  return (
    <div>
      {dirty ? <p role="alert" className="mb-3 text-sm text-warning">Imate nesačuvane izmene. Prvo kliknite „Sačuvaj novu verziju“, pa pošaljite test.</p> : null}
      <AdminActionForm action={action} className="space-y-4" id="newsletter-campaign-test-send" testId="newsletter-campaign-test-send" preserveValues>
        <input type="hidden" name="id" value={campaignId} />
        <input type="hidden" name="savedVersion" value={savedVersion} />
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-medium">Kome šaljemo test?</legend>
          {email ? <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border p-3 text-sm">
            <input type="radio" name="testRecipientMode" value="mine" checked={recipientMode === "mine"} onChange={() => setRecipientMode("mine")} className="mt-1" />
            <span>Moj email<span className="block break-all text-xs text-ink-500">{email}</span></span>
          </label> : null}
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border p-3 text-sm">
            <input type="radio" name="testRecipientMode" value="custom" checked={recipientMode === "custom"} onChange={() => setRecipientMode("custom")} className="mt-1" />
            <span>Druga adresa<span className="block text-xs text-ink-500">Unesite email na koji želite probu.</span></span>
          </label>
        </fieldset>
        <Field label="Adresa za test" hint="Šalje se jedna test poruka na ovu adresu. Izabrane grupe ne utiču na test.">
          <Input name="email" type="email" required maxLength={254} value={recipientEmail} readOnly={recipientMode === "mine"} onChange={(event) => setCustomEmail(event.target.value)} placeholder="ime@primer.rs" />
        </Field>
        <SubmitButton variant="outline" pendingLabel="Šaljem test…" disabled={dirty || !recipientEmail.trim()}>Pošalji test</SubmitButton>
      </AdminActionForm>
    </div>
  );
}
