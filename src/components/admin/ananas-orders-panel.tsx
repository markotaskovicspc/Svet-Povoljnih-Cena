import Link from "next/link";
import { db } from "@/lib/db";
import { formatRsd } from "@/lib/format";
import type { ReportPeriod } from "@/lib/admin/report-period";
import { ananasOrderHref } from "@/lib/ananas/order-rows";
import { ananasConfigured } from "@/lib/ananas/client";
import { importAnanasOrders } from "@/app/admin/erp/ananas/actions";
import { Card, CardTitle, StatCard } from "./card";
import { AdminActionForm } from "./action-form";
import { SubmitButton } from "./submit-button";
const staleRun = (d: Date) => Date.now() - d.getTime() > 300000;
const date = (d: Date) => d.toLocaleString("sr-Latn-RS", { timeZone: "Europe/Belgrade" });
export async function AnanasOrdersPanel({ period, query, page: requestedPage }: { period: ReportPeriod; query: string; page?: string }) {
  const periodWhere = { createdAt: { gte: period.start, lt: period.endExclusive } };
  const where = { ...periodWhere, ...(query ? { OR: [{ id: { contains: query, mode: "insensitive" as const } }, { customerName: { contains: query, mode: "insensitive" as const } }] } : {}) };
  const [count, summary, runs] = await Promise.all([
    db.ananasOrder.count({ where }),
    db.ananasOrder.aggregate({ where: periodWhere, _count: true, _sum: { total: true } }),
    db.ananasSyncRun.findMany({ where: { source: { in: ["ORDERS_AUTO", "ORDERS_MANUAL"] } }, orderBy: { startedAt: "desc" }, take: 5 }),
  ]);
  const pages = Math.max(1, Math.ceil(count / 30)), page = Math.min(pages, Math.max(1, Math.floor(Number(requestedPage) || 1)));
  const rows = await db.ananasOrder.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 30, skip: (page - 1) * 30 });
  const statuses = await db.ananasOrder.groupBy({ by: ["status"], where: periodWhere, _count: true });
  const canImport = ananasConfigured() && period.endExclusive.getTime() - period.start.getTime() <= 31 * 86400000 + 3600000;
  const url = (p: number) => `?${new URLSearchParams({ view: "orders", from: period.fromInput, to: period.toInput, q: query, page: String(p) })}`;
  return <>
    <Card><CardTitle description="Datum kreiranja porudžbine. Iznosi uključuju i otkazane porudžbine; ovo nije fiskalni promet ili isplata.">Ananas porudžbine</CardTitle>
      <div className="grid gap-4 md:grid-cols-2"><StatCard label="Porudžbine u periodu" value={String(summary._count)} /><StatCard label="Vrednost naručenog" value={formatRsd(Number(summary._sum.total ?? 0))} /></div>
      <div className="mt-4 flex flex-wrap gap-3 text-sm">{statuses.map(s => <span className="rounded-lg bg-muted px-3 py-2" key={s.status}>{s.status}: <strong>{s._count}</strong></span>)}</div>
    </Card>
    <Card><CardTitle>Automatsko preuzimanje porudžbina</CardTitle><p className="mb-4 text-sm text-ink-500">Nove porudžbine se preuzimaju svakih 15 minuta. Otvorene porudžbine proveravaju se u ograničenim grupama, a završene povremeno ponovo. Uvoz je samo pregled: ne menja lager, ne šalje robu i ne izdaje račune.</p>
      <AdminActionForm action={importAnanasOrders} refreshOnSuccess><input type="hidden" name="from" value={period.fromInput} /><input type="hidden" name="to" value={period.toInput} /><SubmitButton disabled={!canImport} pendingLabel="Preuzimanje porudžbina…">Preuzmi porudžbine za izabrani period</SubmitButton></AdminActionForm>
      {!canImport && <p className="mt-3 text-sm">Za ručni uvoz izaberite najviše 31 dan i proverite API pristup.</p>}
      <ul className="mt-4 divide-y text-sm">{runs.map(r => <li className="py-2" key={r.id}>{date(r.startedAt)} · {r.status === "SUCCESS" ? `Uspešno · ${r.count} porudžbina` : r.status === "FAILED" ? "Neuspešno — deo podataka može biti osvežen; ponovljen uvoz ne duplira porudžbine" : staleRun(r.startedAt) ? "Prekinuto ili bez potvrde završetka" : "Uvoz u toku"}{r.error && <p className="text-red-700">{r.error}</p>}</li>)}</ul>
    </Card>
    <Card><CardTitle description="Klik na broj otvara artikle, pošiljke i povezane fiskalne dokumente.">Porudžbine · {count}</CardTitle><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{["Broj", "Datum", "Kupac", "Status", "Plaćanje", "Ukupno"].map(t => <th className="p-3" key={t}>{t}</th>)}</tr></thead><tbody>{rows.map(o => <tr className="border-t" key={o.id}><td className="p-3"><Link className="font-medium underline" href={ananasOrderHref(o.id)}>{o.id}</Link></td><td className="p-3">{date(o.createdAt)}</td><td className="p-3">{o.customerName ?? "Nije dostavljeno"}</td><td className="p-3">{o.status}</td><td className="p-3">{o.paymentMethods || "—"}</td><td className="p-3 whitespace-nowrap">{formatRsd(Number(o.total))}</td></tr>)}</tbody></table></div>
      {!rows.length && <p className="py-5 text-sm">Nema preuzetih porudžbina za ovaj period i pretragu.</p>}
      <div className="mt-4 flex gap-4 text-sm">{page > 1 && <Link href={url(page - 1)}>← Prethodna</Link>}<span>Strana {page} / {pages}</span>{page < pages && <Link href={url(page + 1)}>Sledeća →</Link>}</div>
    </Card>
  </>;
}
