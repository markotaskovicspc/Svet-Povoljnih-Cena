"use client";
import { useId, useState } from "react";
import { useSession } from "next-auth/react";
import { Bell, Check } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function RestockWaitlist({ sku, name }: { sku: string; name: string }) {
  // Remount on a family variant change so the confirmation belongs to this SKU only.
  return <Waitlist key={sku} sku={sku} name={name} />;
}
function Waitlist({ sku, name }: { sku: string; name: string }) {
  const { data: session, status } = useSession();
  const registered = session?.user?.userType === "customer";
  const id = useId();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function subscribe(email?: string, website?: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/restock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sku, email, website }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Prijava nije uspela.");
      setDone(true); setOpen(false);
    } catch (err) { setError(err instanceof Error ? err.message : "Pokušajte ponovo."); }
    finally { setBusy(false); }
  }
  return <>
    <button type="button" disabled={busy || done || status === "loading"}
      onClick={() => registered ? void subscribe() : setOpen(true)}
      className="mt-2 flex min-h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-walnut/25 px-2 py-1.5 text-[10px] leading-snug font-medium text-walnut transition hover:bg-walnut/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-walnut disabled:opacity-70">
      {done ? <Check className="size-3 shrink-0" aria-hidden /> : <Bell className="size-3 shrink-0" aria-hidden />}
      {done ? "Obavestićemo vas kada bude dostupan" : busy ? "Prijavljujem…" : "Obavesti me kada artikal bude dostupan"}
    </button>
    {done ? <span className="sr-only" role="status">Prijava za obaveštenje je sačuvana.</span> : null}
    {error && !open ? <p role="alert" className="mt-1 text-xs text-red-700">{error}</p> : null}
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogTitle>Obavesti me kada bude dostupan</DialogTitle>
        <DialogDescription>Ostavite email za obaveštenje o artiklu „{name}”. Poslaćemo vam mejl kada ga ponovo bude moguće naručiti.</DialogDescription>
        <form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void subscribe(String(data.get("email") ?? ""), String(data.get("website") ?? "")); }} className="grid gap-3">
          <label htmlFor={id} className="text-sm font-medium">Email adresa</label>
          <Input id={id} name="email" type="email" autoComplete="email" required maxLength={254} placeholder="vas@email.rs" />
          <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
          <p className="text-xs text-ink-500">Prijavljujete se samo za ovaj artikal. U svakom obaveštenju imate link za odjavu.</p>
          {error ? <p role="alert" className="text-xs text-red-700">{error}</p> : null}
          <Button type="submit" disabled={busy}>{busy ? "Prijavljujem…" : "Obavesti me"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
