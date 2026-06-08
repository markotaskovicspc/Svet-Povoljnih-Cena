"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, MailWarning, Send } from "lucide-react";
import { Button } from "@/components/ui/button";

export function EmailVerificationBanner({ email }: { email?: string | null }) {
  const [status, setStatus] = useState<"idle" | "sent" | "error">("idle");
  const [pending, startTransition] = useTransition();

  function resend() {
    setStatus("idle");
    startTransition(() => {
      void fetch("/api/auth/email-verification/resend", { method: "POST" })
        .then((response) => {
          if (!response.ok) throw new Error("send_failed");
          setStatus("sent");
        })
        .catch(() => setStatus("error"));
    });
  }

  return (
    <section className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-ink-800">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <MailWarning className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
          <div>
            <h2 className="font-display text-lg text-ink-900">
              Potvrdite e-poštu
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-ink-600">
              Poslali smo link za potvrdu{email ? ` na ${email}` : ""}. Dok je
              e-pošta nepotvrđena, povremeno ćemo vas podsetiti.
            </p>
            {status === "sent" ? (
              <p className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-success">
                <CheckCircle2 className="size-4" aria-hidden />
                Novi link je poslat.
              </p>
            ) : status === "error" ? (
              <p className="mt-2 text-sm font-medium text-destructive">
                Slanje trenutno nije uspelo. Pokušajte ponovo malo kasnije.
              </p>
            ) : null}
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          className="shrink-0 gap-2 bg-white"
          disabled={pending}
          onClick={resend}
        >
          <Send className="size-4" aria-hidden />
          {pending ? "Slanje..." : "Pošalji ponovo"}
        </Button>
      </div>
    </section>
  );
}
