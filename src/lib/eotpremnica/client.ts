import "server-only";
import { envValue } from "@/lib/env";
export class EotpremnicaUnknownOutcome extends Error {}

export async function requestChanges(config: { baseUrl: string; apiKey: string }, requestId: string, date: string, request: typeof fetch = fetch) {
  const url = new URL("/public/documents/requests/changes", config.baseUrl);
  url.searchParams.set("date", date);
  url.searchParams.set("requestId", requestId);
  const items: Array<{ type: string; requestId: string; documentId: string | null; status: string | null }> = [];
  const seenPages = new Set<string>();
  for (let page = 0; page < 100; page++) {
    url.searchParams.set("page", String(page));
    const response = await request(url.toString(), { headers: { accept: "application/json", "Api-key": config.apiKey }, signal: AbortSignal.timeout(15_000), redirect: "error", cache: "no-store" });
    if (!response.ok) throw new Error(`eOtpremnica provera je vratila HTTP ${response.status}.`);
    const data = await response.json() as { items?: unknown[]; totalPages?: number; hasNextPage?: boolean };
    if (!Array.isArray(data.items)) throw new Error("eOtpremnica nije vratila ispravan API odgovor.");
    const signature = JSON.stringify(data.items);
    if (data.items.length && seenPages.has(signature)) throw new Error("eOtpremnica ponavlja istu stranicu; provera nije potpuna.");
    seenPages.add(signature);
    for (const raw of data.items) {
      if (!raw || typeof raw !== "object") throw new Error("Neispravna eOtpremnica promena.");
      const row = raw as Record<string, unknown>, payload = row.data && typeof row.data === "object" ? row.data as Record<string, unknown> : {};
      if (typeof row.type !== "string" || typeof row.requestId !== "string") throw new Error("Neispravna eOtpremnica promena.");
      if (row.requestId === requestId) items.push({ type: row.type, requestId: row.requestId, documentId: typeof payload.documentId === "string" ? payload.documentId : typeof row.documentId === "string" ? row.documentId : null, status: typeof payload.status === "string" ? payload.status : null });
    }
    if (!data.items.length || data.hasNextPage === false || typeof data.totalPages === "number" && page + 1 >= data.totalPages) return items;
    // Changes API uses 0-based paging; an empty next page terminates unknown page metadata.
  }
  throw new Error("Previše stranica eOtpremnica promena; provera nije potpuna.");
}

export async function eotpremnicaHealth() {
  const apiKey = envValue("EOTPREMNICA_API_KEY");
  if (!apiKey) return { ok: false, mode: null, message: "Nedostaje EOTPREMNICA_API_KEY." };
  const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Belgrade" }).format(new Date());
  for (const mode of ["production", "sandbox"] as const) {
    const baseUrl = mode === "production" ? "https://api.eotpremnica.mfin.gov.rs" : "https://api.demoeotpremnica.mfin.gov.rs";
    try {
      await requestChanges({ baseUrl, apiKey }, "spc-connection-check", date);
      return { ok: true, mode, message: `eOtpremnica API ključ radi (${mode}).` };
    } catch { /* Only known official hosts are probed; never expose response bodies. */ }
  }
  return { ok: false, mode: null, message: "Ključ nije potvrdio eOtpremnica vezu na pravom ni demo API-ju." };
}
