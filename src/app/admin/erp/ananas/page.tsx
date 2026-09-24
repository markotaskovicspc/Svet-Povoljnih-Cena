import Link from "next/link";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireAdminAction } from "@/lib/admin";
import { resolveReportPeriod } from "@/lib/admin/report-period";
import { ananasConfigured } from "@/lib/ananas/client";
import { formatRsd } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardTitle } from "@/components/admin/card";
import { AnanasSummary } from "@/components/admin/ananas-summary";
import { AdminActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { importAnanas } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const metadata = { title: "Ananas — računi i promet", robots: { index: false, follow: false } };
function staleRun(startedAt: Date) { return Date.now() - startedAt.getTime() > 300000; }
const date = (value: Date) => value.toLocaleString("sr-Latn-RS", { timeZone: "Europe/Belgrade" });

export default async function AnanasPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; page?: string; q?: string; kind?: string }> }) {
  await requireAdminAction(["OPS"]);
  const sp = await searchParams;
  const period = resolveReportPeriod({ range: "custom", from: sp.from, to: sp.to });
  const q = (sp.q ?? "").trim().slice(0, 200);
  const kind = sp.kind === "SALE" || sp.kind === "REFUND" ? sp.kind : undefined;
  const where: Prisma.AnanasDocumentWhereInput = { issuedAt: { gte: period.start, lt: period.endExclusive }, kind,
    ...(q ? { OR: [{ fiscalNumber: { contains: q, mode: "insensitive" } }, { orderNumber: { contains: q, mode: "insensitive" } }, { suborderNumber: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const count = await db.ananasDocument.count({ where });
  const pages = Math.max(1, Math.ceil(count / 50));
  const page = Math.min(pages, Math.max(1, Math.floor(Number(sp.page) || 1)));
  const [rows, runs] = await Promise.all([
    db.ananasDocument.findMany({ where, orderBy: [{ issuedAt: "desc" }, { id: "desc" }], take: 50, skip: (page - 1) * 50 }),
    db.ananasSyncRun.findMany({ orderBy: { startedAt: "desc" }, take: 5 }),
  ]);
  const configured = ananasConfigured();
  const canImport = configured && period.endExclusive.getTime() - period.start.getTime() <= 31 * 86400000 + 3600000;
  const pageUrl = (value: number) => `?${new URLSearchParams({ from: period.fromInput, to: period.toInput, q, kind: kind ?? "", page: String(value) })}`;
  return <>
    <PageHeader title="Ananas" description="Fiskalne račune izdaje Ananas. Ovde ih preuzimate i pratite promet i refundacije." />
    <div className="space-y-6 px-4 py-6 md:px-8">
      <Card>
        <form className="flex flex-wrap items-end gap-3">
          <label className="text-sm">Od<input className="mt-1 block rounded-lg border p-2" type="date" name="from" defaultValue={period.fromInput} required /></label>
          <label className="text-sm">Do<input className="mt-1 block rounded-lg border p-2" type="date" name="to" defaultValue={period.toInput} required /></label>
          <label className="text-sm">Dokumenti<select className="mt-1 block rounded-lg border p-2" name="kind" defaultValue={kind ?? ""}><option value="">Svi</option><option value="SALE">Računi</option><option value="REFUND">Refundacije</option></select></label>
          <label className="text-sm">Pretraga<input className="mt-1 block rounded-lg border p-2" name="q" defaultValue={q} placeholder="Broj računa ili porudžbine" maxLength={200} /></label>
          <button className="rounded-lg border px-4 py-2 text-sm">Prikaži</button>
        </form>
      </Card>
      <AnanasSummary period={period} />
      <Card>
        <CardTitle>Povezivanje i preuzimanje</CardTitle>
        <p className="mb-4 text-sm text-ink-500">Automatsko preuzimanje radi svakog sata i ponovo proverava prethodnih 7 dana. Ručno možete uvesti do 31 dan odjednom. Ponovni uvoz ne duplira račune. Uvoz ne pravi nove porudžbine i ne menja lager.</p>
        {!configured && <p className="mb-4 text-sm text-red-700">Produkcioni API pristup nije podešen na serveru.</p>}
        {configured && !canImport && <p className="mb-4 text-sm">Za ručni uvoz skratite izabrani period na najviše 31 dan.</p>}
        <AdminActionForm action={importAnanas} refreshOnSuccess>
          <input type="hidden" name="from" value={period.fromInput} /><input type="hidden" name="to" value={period.toInput} />
          <SubmitButton disabled={!canImport} pendingLabel="Preuzimanje računa…">Preuzmi izabrani period</SubmitButton>
        </AdminActionForm>
        <ul className="mt-4 divide-y text-sm">{runs.map(run => <li key={run.id} className="py-3">
          <span className="font-medium">{date(run.startedAt)} · {run.status === "SUCCESS" ? `Uspešno · ${run.count} dokumenata` : run.status === "FAILED" ? "Neuspešno" : staleRun(run.startedAt) ? "Prekinuto ili bez potvrde završetka — ponovite uvoz" : "Preuzimanje u toku"}</span>
          <p className="text-ink-500">{date(run.from)} – {date(new Date(run.to.getTime() - 1))}</p>
          {run.error && <p className="text-red-700">{run.error}</p>}
        </li>)}</ul>
      </Card>
      <Card>
        <CardTitle description="Zbir iznad obuhvata sve dokumente u periodu; pretraga i tip filtriraju samo ovu listu.">Računi i refundacije · {count}</CardTitle>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-3">Datum</th><th className="p-3">Dokument</th><th className="p-3">Porudžbina</th><th className="p-3 text-right">Iznos sa PDV-om</th><th className="p-3">PDF</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.id} className="border-b align-top"><td className="p-3 whitespace-nowrap">{date(row.issuedAt)}</td><td className="p-3"><p className="font-medium">{row.fiscalNumber}</p><p>{row.kind === "SALE" ? "Račun" : "Refundacija"}</p>{row.reference && <p className="text-xs text-ink-500">Po računu: {row.reference}</p>}</td><td className="p-3">{row.orderNumber}<p className="text-xs text-ink-500">{row.suborderNumber}</p></td><td className="p-3 text-right whitespace-nowrap">{row.kind === "REFUND" ? "−" : ""}{formatRsd(Number(row.gross))}<p className="text-xs text-ink-500">PDV: {formatRsd(Number(row.vat))}</p></td><td className="p-3"><a className="underline" href={`/api/admin/ananas/${row.id}/pdf`} target="_blank" rel="noopener noreferrer">Otvori PDF</a></td></tr>)}</tbody>
        </table></div>
        {!rows.length && <p className="py-6 text-sm text-ink-500">Nema preuzetih dokumenata za izabrane filtere. Proverite period i status uvoza.</p>}
        <div className="mt-4 flex gap-4 text-sm">{page > 1 && <Link href={pageUrl(page - 1)}>← Prethodna</Link>}<span>Strana {page} / {pages}</span>{page < pages && <Link href={pageUrl(page + 1)}>Sledeća →</Link>}</div>
      </Card>
    </div>
  </>;
}
