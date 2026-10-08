import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminAction } from "@/lib/admin";
import { db } from "@/lib/db";
import { isCancelledDelivery } from "@/lib/courier/cancelled-delivery";
import { boxQuantity } from "@/lib/courier/label-quantity";
import { pickupLabelArticles, pickupLabelSort, selectPickupLabels } from "@/lib/admin/pickup-label-selection";

export const dynamic = "force-dynamic";
export const metadata = { title: "Kurirske adresnice · ERP", robots: { index: false, follow: false } };

export default async function PickupLabelsPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string | string[]; sort?: string | string[] }>;
}) {
  await requireAdminAction(["OPS"]);
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const q = typeof query.q === "string" ? query.q.trim() : "";
  const sort = pickupLabelSort(query.sort);
  const batch = await db.pickupBatch.findUnique({
    where: { id },
    select: {
      id: true, number: true, provider: true, labelsCreatedAt: true,
      lines: {
        where: { deferredAt: null },
        orderBy: [{ orderId: "asc" }, { packageNo: "asc" }],
        select: {
          id: true, packageNo: true, purpose: true, packedItems: true, packedQuantity: true,
          order: { select: { number: true, status: true, cancelledAt: true } },
          orderItem: { select: { name: true, sku: true } },
          reclamation: { select: { resolution: true, resolutionNote: true } },
        },
      },
    },
  });
  if (!batch) notFound();
  const active = batch.lines.filter(line => !isCancelledDelivery(line));
  const selected = selectPickupLabels(active, q, sort);
  const path = `/admin/erp/preuzimanja/${batch.id}/adresnice`;
  const pdfQuery = new URLSearchParams({ q, sort }).toString();
  const canPrint = Boolean(batch.labelsCreatedAt && selected.length);

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <Link href={`/admin/erp/preuzimanja/${batch.id}`} className="text-sm text-walnut hover:underline">← Nazad na nalog</Link>
      <header>
        <h1 className="text-2xl font-semibold">Kurirske adresnice</h1>
        <p className="mt-1 text-sm text-ink-500">{batch.number} · {batch.provider === "MYGLS" ? "MyGLS" : "X Express"}</p>
      </header>
      <form action={path} className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-background p-4">
        <label className="min-w-60 flex-1 text-sm font-medium">
          Naziv ili šifra artikla
          <input type="search" name="q" defaultValue={q} placeholder="Unesite naziv ili šifru artikla" className="mt-1 block h-10 w-full rounded-md border border-border bg-background px-3" />
        </label>
        <label className="text-sm font-medium">
          Redosled štampe
          <select name="sort" defaultValue={sort} className="mt-1 block h-10 rounded-md border border-border bg-background px-3">
            <option value="order">Po porudžbini</option>
            <option value="name">Po nazivu artikla (A–Ž)</option>
            <option value="sku">Po šifri artikla (rastuće)</option>
          </select>
        </label>
        <button type="submit" className="h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background">Primeni</button>
        <Link href={path} className="inline-flex h-10 items-center px-2 text-sm underline">Poništi filtere</Link>
      </form>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="text-sm">Za štampu: <strong>{selected.length}</strong> od {active.length} adresnica</p>
        {canPrint ? <a href={`/api/admin/erp/preuzimanja/${batch.id}/labels?${pdfQuery}`} target="_blank" rel="noreferrer" className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background">Otvori PDF za štampu ({selected.length})</a> : null}
      </div>
      {!batch.labelsCreatedAt ? <p className="rounded-lg border border-border p-4 text-sm">Adresnice još nisu kreirane. Na nalogu prvo kliknite „Kreiraj adresnice i pošalji“.</p> : null}
      <p className="text-sm text-ink-500">PDF prati primenjeni filter i redosled iz tabele. Paket sa više artikala prikazuje se jednom ako odgovara pretrazi; pri sortiranju se koristi prvi artikal po izabranom redosledu.</p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted"><tr><th className="p-3">Porudžbina</th><th className="p-3">Paket</th><th className="p-3">Šifra i naziv artikla</th><th className="p-3 text-right">Komada u paketu</th></tr></thead>
          <tbody>
            {selected.map(line => <tr key={line.id} className="border-t border-border align-top">
              <td className="p-3">{line.order.number}</td><td className="p-3">{line.packageNo}</td>
              <td className="p-3">{pickupLabelArticles(line).map((article, index) => <div key={index}><span className="font-mono font-medium">{article.sku || "—"}</span> · {article.name}</div>)}</td>
              <td className="p-3 text-right">{boxQuantity(line)}</td>
            </tr>)}
            {!selected.length ? <tr><td colSpan={4} className="p-6 text-center text-ink-500">Nema adresnica za zadati naziv ili šifru artikla.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </main>
  );
}
