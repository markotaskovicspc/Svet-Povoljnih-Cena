"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MailCheck, MailX, LoaderCircle } from "lucide-react";

type Result = { ok: boolean; reason?: string };
export function NewsletterConfirmation({ token, status, confirm }: { token: string; status?: string; confirm: (token: string) => Promise<Result> }) {
  const [result, setResult] = useState<Result | null>(status ? { ok: status === "success", reason: status } : !token ? { ok: false, reason: "invalid" } : null);
  const [networkError, setNetworkError] = useState(false);
  const started = useRef(false);
  const run = useCallback(async () => {
    if (started.current || !token) return;
    started.current = true; setNetworkError(false);
    try { setResult(await confirm(token)); }
    catch { started.current = false; setNetworkError(true); }
  }, [confirm, token]);
  useEffect(() => {
    if (status || !token) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      // GET, HEAD, prefetch and hidden/prerendered documents never confirm.
      // Full browser scanners that execute visible JavaScript cannot be reliably
      // distinguished from people without asking for another interaction.
      if (document.visibilityState === "visible" && !(document as Document & { prerendering?: boolean }).prerendering) timer = setTimeout(() => { void run(); }, 700);
    };
    schedule(); document.addEventListener("visibilitychange", schedule); document.addEventListener("prerenderingchange", schedule);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", schedule); document.removeEventListener("prerenderingchange", schedule); };
  }, [run, status, token]);
  const Icon = result?.ok ? MailCheck : result || networkError ? MailX : LoaderCircle;
  return <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-4 py-16 text-center" aria-live="polite">
    <Icon className={`size-12 ${result?.ok ? "text-success" : "text-ink-500"} ${!result && !networkError ? "animate-spin" : ""}`} aria-hidden />
    <h1 className="font-display mt-5 text-3xl text-ink-900">{result?.ok ? "Newsletter prijava je potvrđena" : networkError ? "Potvrda trenutno nije uspela" : result ? "Link nije važeći" : "Potvrđujemo vašu prijavu…"}</h1>
    <p className="mt-3 text-sm leading-relaxed text-ink-600">{result?.ok ? "Hvala vam. Od sada možete da primate akcije, kupone i najbolje ponude." : networkError ? "Proverite vezu i pokušajte ponovo." : result?.reason === "expired" ? "Link je istekao. Prijavite se ponovo preko newsletter forme." : result ? "Link nije ispravan ili više ne može da se koristi. Prijavite se ponovo preko newsletter forme." : "Sačekajte trenutak. Nije potreban dodatni klik."}</p>
    {networkError && <button type="button" onClick={() => void run()} className="mt-6 rounded-full bg-ink-900 px-6 py-3 text-white">Pokušaj ponovo</button>}
    {result?.ok && <Link href="/" className="mt-6 rounded-full bg-ink-900 px-6 py-3 text-white">Nastavi kupovinu</Link>}
  </div>;
}
