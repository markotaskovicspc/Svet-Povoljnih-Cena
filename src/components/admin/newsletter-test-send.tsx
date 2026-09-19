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
      <AdminActionForm action={action} className="flex flex-wrap items-end gap-3" id="newsletter-campaign-test-send" testId="newsletter-campaign-test-send" preserveValues>
        <input type="hidden" name="id" value={campaignId} />
        <input type="hidden" name="savedVersion" value={savedVersion} />
        <Field label="Adresa za test" className="min-w-0 flex-1"><Input name="email" type="email" required defaultValue={email} /></Field>
        <SubmitButton variant="outline" pendingLabel="Šaljem…" disabled={dirty}>Pošalji test</SubmitButton>
      </AdminActionForm>
    </div>
  );
}
