import "server-only";
import { z } from "zod";
import { envValue } from "@/lib/env";
import { safeAnanasPdfUrl } from "./documents";

const BASE = "https://api.ananas.rs";
export function ananasConfigured() { return Boolean(envValue("ANANAS_CLIENT_ID") && envValue("ANANAS_CLIENT_SECRET")); }
export class AnanasClient {
  private token: string | null = null;
  constructor(private readonly request: typeof fetch = fetch, private readonly deadline?: AbortSignal) {}
  private signal(milliseconds: number) {
    const timeout = AbortSignal.timeout(milliseconds);
    return this.deadline ? AbortSignal.any([timeout, this.deadline]) : timeout;
  }
  private async authenticate() {
    const clientId = envValue("ANANAS_CLIENT_ID"), clientSecret = envValue("ANANAS_CLIENT_SECRET");
    if (!clientId || !clientSecret) throw new Error("Ananas produkcioni pristup nije podešen.");
    const response = await this.request(`${BASE}/iam/api/v1/auth/token`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grantType: "CLIENT_CREDENTIALS", clientId, clientSecret, scope: "public_api/full_access" }),
      cache: "no-store", redirect: "error", signal: this.signal(25000),
    });
    if (!response.ok) throw new Error(`Ananas prijava je odbijena (HTTP ${response.status}). Proverite API pristup sa Ananas podrškom.`);
    const payload = z.object({ access_token: z.string().min(10) }).parse(await response.json());
    this.token = payload.access_token;
  }
  private async get(path: string, params: URLSearchParams) {
    if (!this.token) await this.authenticate();
    const send = () => this.request(`${BASE}/order/api/v1/merchant-integration/${path}?${params}`, {
      headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json" },
      cache: "no-store", redirect: "error", signal: this.signal(45000),
    });
    let response = await send();
    if (response.status === 401) { await this.authenticate(); response = await send(); }
    if (!response.ok) throw new Error(`Ananas čitanje nije uspelo (HTTP ${response.status}). Pokušajte kasnije ili proverite API pristup.`);
    return response.json() as Promise<unknown>;
  }
  async documents(kind: "SALE" | "REFUND", start: Date, endExclusive: Date) {
    const payload = await this.get(kind === "SALE" ? "invoices" : "invoice-corrections", new URLSearchParams({ type: "FISCAL", dateFrom: start.toISOString(), dateTo: new Date(endExclusive.getTime() - 1).toISOString() }));
    return z.array(z.unknown()).max(10000).parse(payload);
  }
  async pdf(kind: string, suborder: string, externalId: string) {
    const payload = z.record(z.string(), z.array(z.object({ documentCorrelationId: z.union([z.string(), z.number()]), link: z.string() }))).parse(await this.get(kind === "SALE" ? "invoices/urls" : "invoice-corrections/urls", new URLSearchParams({ suborderIds: suborder, type: "FISCAL" })));
    const document = payload[suborder]?.find(item => String(item.documentCorrelationId) === externalId);
    if (!document) throw new Error("Ananas nije vratio PDF za ovaj dokument.");
    return safeAnanasPdfUrl(document.link);
  }
  async orders(params: URLSearchParams) { return this.pages("orders", params); }
  async shipments(params: URLSearchParams) {
    if (!params.has("search") && !params.has("statusGroup")) throw new Error("Ananas filter pošiljki je obavezan.");
    return this.pages("outbound-orders/shipments", params);
  }
  async shipmentsInPeriod(statusGroup: string, from: Date, to: Date) {
    // confirmedFrom excludes FBA cancellations without a confirmation date.
    // The documented default sort is purchaseDate DESC; stop at the date boundary.
    return this.pages("outbound-orders/shipments", new URLSearchParams({ statusGroup }), { from, to });
  }
  private async pages(path: string, filters: URLSearchParams, period?: { from: Date; to: Date }) {
    const rows: unknown[] = [];
    for (let page = 0; page < 50; page++) {
      const params = new URLSearchParams(filters);
      params.set("page", String(page)); params.set("size", "100");
      await new Promise(resolve => setTimeout(resolve, 250));
      const data = z.object({ content: z.array(z.unknown()).max(100), last: z.boolean() }).parse(await this.get(path, params));
      if (period) {
        const dated = data.content.map(row => {
          const value = z.object({ createdDate: z.string().datetime({ offset: true }) }).parse(row);
          return { row, date: new Date(value.createdDate) };
        });
        rows.push(...dated.filter(x => x.date >= period.from && x.date < period.to).map(x => x.row));
        if (dated.length && dated.every(x => x.date < period.from)) return rows;
      } else rows.push(...data.content);
      if (data.last) return rows;
      if (!data.content.length) throw new Error("Ananas paginacija nije potpuna. Uvoz nije završen.");
    }
    throw new Error("Ananas period sadrži previše porudžbina. Izaberite kraći period.");
  }
}
