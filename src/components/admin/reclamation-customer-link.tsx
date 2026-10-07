"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ReclamationCustomerLink() {
  const [number, setNumber] = useState("");
  const [suggestions, setSuggestions] = useState<{ number: string }[]>([]);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (number.trim().length < 3) return;
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      try {
        const response = await fetch(`/api/admin/reclamations/order-search?q=${encodeURIComponent(number.trim())}`, { signal: controller.signal });
        const data = await response.json();
        if (response.ok) setSuggestions(data.data ?? []);
      } catch { /* Search suggestions are optional; exact input still works. */ }
    }, 250);
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [number]);
  async function generate(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage(""); setLink("");
    try {
      const response = await fetch("/api/admin/reclamations/customer-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderNumberOrFiscal: number }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "Link trenutno nije moguće napraviti.");
      setLink(new URL(data.path, window.location.origin).href);
      setMessage(`Link za ${data.orderNumber} važi 7 dana. Pošaljite ga kupcu mejlom ili u poruci. Kupcu nije potreban nalog.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Pokušajte ponovo."); }
    finally { setBusy(false); }
  }
  return <section className="rounded-xl border border-border bg-surface p-5">
    <h2 className="text-lg font-semibold">Pošalji kupcu obrazac za reklamaciju</h2>
    <p className="mt-1 text-sm text-ink-500">Izaberite porudžbinu, napravite link i pošaljite ga kupcu preko mejla, Facebooka ili druge poruke. Kupac sam unosi problem i fotografije, a prijava stiže u ovaj dnevnik.</p>
    <form onSubmit={generate} className="mt-4 flex flex-wrap items-end gap-3">
      <label className="grid min-w-0 flex-1 gap-1 text-sm">Broj porudžbine ili fiskalnog računa
        <Input required minLength={3} maxLength={80} list="reclamation-link-orders" placeholder="npr. SPC-2026-001202" value={number} onChange={event => { setNumber(event.target.value); setLink(""); setMessage(""); setSuggestions([]); }} />
      </label>
      <datalist id="reclamation-link-orders">{suggestions.map(order => <option key={order.number} value={order.number} />)}</datalist>
      <Button disabled={busy} type="submit">{busy ? "Pravim link…" : "Napravi link za kupca"}</Button>
    </form>
    {message ? <p role="status" className="mt-3 text-sm">{message}</p> : null}
    {link ? <div className="mt-3 flex flex-wrap gap-2">
      <Input aria-label="Link za kupca" readOnly value={link} onFocus={event => event.target.select()} className="min-w-0 flex-1" />
      <Button type="button" onClick={async () => { try { await navigator.clipboard.writeText(link); setMessage("Link je kopiran. Nalepite ga u poruku kupcu. Važi 7 dana."); } catch { setMessage("Označite link u polju i kopirajte ga u poruku kupcu."); } }}>Kopiraj link</Button>
    </div> : null}
  </section>;
}
