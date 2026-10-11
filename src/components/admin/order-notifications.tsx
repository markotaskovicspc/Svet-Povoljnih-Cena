"use client";

import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";

async function requestPush(body?: unknown) {
  const response = await fetch("/api/admin/push", {
    method: body ? "POST" : "GET", cache: "no-store",
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || "Obaveštenja trenutno nisu dostupna."), { status: response.status });
  return data;
}

function applicationKey(key: string) {
  const bytes = atob(key.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - key.length % 4) % 4));
  return Uint8Array.from(bytes, char => char.charCodeAt(0));
}

export function OrderNotifications({ adminId }: { adminId: string }) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!detailsRef.current?.contains(event.target as Node) && detailsRef.current) detailsRef.current.open = false; };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && detailsRef.current?.open) { detailsRef.current.open = false; detailsRef.current.querySelector("summary")?.focus(); } };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, []);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Proveravam obaveštenja…");

  useEffect(() => {
    let cancelled = false;
    async function initialize() {
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      const standalone = window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone;
      if (ios && !standalone) {
        setMessage('iPhone: u Safariju izaberite Podeli → Dodaj na početni ekran. Otvorite SPC Admin preko ikonice, prijavite se i uključite obaveštenja.');
        return;
      }
      if (!window.isSecureContext || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setMessage("Ovaj pregledač ne podržava push obaveštenja. Na iPhone-u je potreban iOS 16.4 ili noviji.");
        return;
      }
      const config = await requestPush();
      if (!config.configured) {
        setMessage("Obaveštenja još nisu podešena na serveru.");
        return;
      }
      await navigator.serviceWorker.register("/admin-push-sw.js", { scope: "/admin", updateViaCache: "none" });
      const worker = await navigator.serviceWorker.ready;
      const sub = await worker.pushManager.getSubscription();
      const status = sub ? await requestPush({ operation: "status", endpoint: sub.endpoint }) : { subscribed: false };
      if (cancelled) return;
      setRegistration(worker);
      setPublicKey(config.publicKey);
      setSubscription(sub);
      setEnabled(status.subscribed && Notification.permission === "granted");
      setMessage(Notification.permission === "denied"
        ? "Obaveštenja su blokirana. Dozvolite ih u podešavanjima pregledača ili telefona, pa ponovo otvorite ovu stranu."
        : status.subscribed ? "Obaveštenja o novim porudžbinama su uključena na ovom uređaju." : "Primajte nove porudžbine i kada sajt nije otvoren.");
    }
    initialize().catch(error => { if (!cancelled) setMessage(error.message); });
    return () => { cancelled = true; };
  }, [adminId]);

  async function enable() {
    if (!registration || !publicKey) return;
    // Ask directly from the click, before network requests, for Safari's user gesture requirement.
    const permission = Notification.requestPermission();
    setBusy(true);
    try {
      if (await permission !== "granted") throw new Error("Dozvolite obaveštenja da biste primali nove porudžbine.");
      let sub = await registration.pushManager.getSubscription();
      const expectedKey = applicationKey(publicKey);
      const currentKey = sub?.options.applicationServerKey;
      if (sub && currentKey && new Uint8Array(currentKey).some((byte, index) => byte !== expectedKey[index])) {
        await sub.unsubscribe();
        sub = null;
      }
      sub ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: expectedKey });
      await requestPush({ operation: "subscribe", subscription: sub.toJSON() });
      setSubscription(sub);
      setEnabled(true);
      setMessage("Obaveštenja su uključena. Pošaljite probno obaveštenje da proverite telefon.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Uključivanje nije uspelo. Pokušajte ponovo.");
    } finally { setBusy(false); }
  }

  async function change(operation: "test" | "unsubscribe") {
    if (!subscription) return;
    setBusy(true);
    try {
      await requestPush({ operation, endpoint: subscription.endpoint });
      if (operation === "unsubscribe") {
        await subscription.unsubscribe();
        setSubscription(null);
        setEnabled(false);
        setMessage("Obaveštenja su isključena na ovom uređaju.");
      } else setMessage("Probno obaveštenje je poslato. Proverite obaveštenja na uređaju i Focus režim.");
    } catch (error) {
      if (error && typeof error === "object" && "status" in error && [404, 410].includes(Number(error.status))) setEnabled(false);
      setMessage(error instanceof Error ? error.message : "Pokušajte ponovo.");
    } finally { setBusy(false); }
  }

  return (
    <details ref={detailsRef} className="relative print:hidden">
      <summary aria-label="Obaveštenja o porudžbinama" title={enabled ? "Obaveštenja o porudžbinama su uključena" : "Podesi obaveštenja o porudžbinama"} className="relative flex h-8 w-9 cursor-pointer list-none items-center justify-center rounded-lg border border-border bg-background transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <Bell className="size-4" aria-hidden />
        {enabled && <span className="absolute right-1 top-1 size-1.5 rounded-full bg-green-500" aria-hidden />}
      </summary>
      <div className="fixed inset-x-4 top-20 z-50 mt-2 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:w-[min(22rem,calc(100vw-2rem))] space-y-3 rounded-xl border border-border bg-surface p-4 shadow-xl">
        <h2 className="text-sm font-semibold">Obaveštenja o porudžbinama</h2>
        <p className="text-sm text-ink-500" role="status">{message}</p>
        {registration && publicKey && (
          <div className="flex flex-wrap gap-2">
            {enabled ? <>
              <Button type="button" size="sm" disabled={busy} onClick={() => change("test")}>Pošalji probno obaveštenje</Button>
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => change("unsubscribe")}>Isključi na ovom uređaju</Button>
            </> : <Button type="button" size="sm" disabled={busy} onClick={enable}>Uključi obaveštenja</Button>}
          </div>
        )}
      </div>
    </details>
  );
}
