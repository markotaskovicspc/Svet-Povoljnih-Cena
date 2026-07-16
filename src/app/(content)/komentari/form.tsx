"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function CommentForm() {
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function submit(formData: FormData) {
    setStatus("sending");
    const response = await fetch("/api/comments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: formData.get("name"),
        email: formData.get("email"),
        subject: formData.get("subject") || undefined,
        body: formData.get("body"),
      }),
    });
    setStatus(response.ok ? "sent" : "error");
  }

  if (status === "sent") {
    return <p className="rounded-xl bg-muted-bg p-4 text-sm text-ink-700">Hvala. Poruka je bezbedno primljena.</p>;
  }

  return (
    <form action={submit} className="not-prose mt-4 grid gap-4" aria-busy={status === "sending"}>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm text-ink-700">
          Ime
          <Input name="name" required minLength={2} maxLength={120} autoComplete="name" />
        </label>
        <label className="grid gap-1.5 text-sm text-ink-700">
          E-pošta
          <Input name="email" type="email" required autoComplete="email" />
        </label>
      </div>
      <label className="grid gap-1.5 text-sm text-ink-700">
        Tema (opciono)
        <Input name="subject" maxLength={160} />
      </label>
      <label className="grid gap-1.5 text-sm text-ink-700">
        Poruka
        <Textarea name="body" required minLength={5} maxLength={2000} rows={7} />
      </label>
      {status === "error" ? (
        <p role="alert" className="text-sm text-destructive">
          Poruka nije poslata. Proverite podatke ili pokušajte kasnije.
        </p>
      ) : null}
      <Button type="submit" disabled={status === "sending"} className="w-fit">
        {status === "sending" ? "Šaljemo…" : "Pošalji poruku"}
      </Button>
    </form>
  );
}
