import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAdminAction } from "@/lib/admin";
import { db } from "@/lib/db";
import { PrintPageButton } from "@/components/admin/print-page-button";
import { AutoPrintOnLoad } from "@/components/admin/auto-print-on-load";
import { buildPickupPrintRows } from "@/lib/admin/pickup-print";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Štampa naloga za preuzimanje · ERP",
  robots: { index: false, follow: false },
};

export default async function PickupBatchPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ section?: string; autoprint?: string }>;
}) {
  await requireAdminAction(["OPS"]);
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (query.section === "labels") {
    redirect(`/api/admin/erp/preuzimanja/${id}/labels`);
  }
  const batch = await db.pickupBatch.findUnique({
    where: { id },
    include: {
      lines: {
        orderBy: [{ orderId: "asc" }, { packageNo: "asc" }],
        include: {
          orderItem: {
            select: {
              id: true,
              sku: true,
              name: true,
              qty: true,
            },
          },
        },
      },
    },
  });
  if (!batch) notFound();

  const picking = buildPickupPrintRows(batch.lines);

  return (
    <main className="mx-auto max-w-[1200px] space-y-8 bg-white p-6 text-black print:max-w-none print:p-0">
      {query.autoprint === "1" ? <AutoPrintOnLoad /> : null}
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href={`/admin/erp/preuzimanja/${batch.id}`}
          className="text-sm text-walnut hover:underline"
        >
          ← Nazad na nalog
        </Link>
        <div className="flex flex-wrap gap-2">
          {batch.labelsCreatedAt ? (
            <Link
              href={`/api/admin/erp/preuzimanja/${batch.id}/labels`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center rounded-lg border border-black bg-white px-3 text-sm font-medium"
            >
              Otvori sve kurirske adresnice
            </Link>
          ) : (
            <span
              aria-disabled="true"
              title="Prvo na nalogu kliknite „Kreiraj adresnice i pošalji“."
              className="inline-flex h-9 cursor-not-allowed items-center rounded-lg border border-black/30 bg-black/5 px-3 text-sm font-medium text-black/45"
            >
              Adresnice još nisu kreirane
            </span>
          )}
          <PrintPageButton label="Štampaj picking listu" />
        </div>
      </div>

      <section>
        <header className="border-b-2 border-black pb-4">
          <p className="text-xs font-bold uppercase tracking-[0.16em]">Svet povoljnih cena · magacin</p>
          <h1 className="mt-1 text-3xl font-bold">Zbirna picking lista</h1>
          <dl className="mt-3 grid grid-cols-2 gap-x-8 gap-y-1 text-sm sm:grid-cols-3">
            <dt>Nalog</dt><dd className="font-bold">{batch.number}</dd>
            <dt>Kurir</dt><dd className="font-bold">{providerLabel(batch.provider)}</dd>
            <dt>Paketa</dt><dd className="font-bold">{batch.lines.length}</dd>
          </dl>
        </header>
        <table className="mt-5 w-full border-collapse text-sm">
          <thead>
            <tr className="border-y-2 border-black text-left">
              <th className="w-12 py-2">✓</th>
              <th className="py-2">Interna šifra</th>
              <th className="py-2">Naziv artikla</th>
              <th className="py-2 text-right">Komada</th>
              <th className="py-2 text-right">Paketa</th>
            </tr>
          </thead>
          <tbody>
            {picking.map((row) => (
              <tr key={row.key} className="border-b border-black/30 align-top">
                <td className="py-3"><span className="inline-block size-5 border border-black" /></td>
                <td className="py-3 font-mono font-bold">{row.sku}</td>
                <td className="py-3">{row.name}</td>
                <td className="py-3 text-right text-lg font-bold">{row.quantity}</td>
                <td className="py-3 text-right">{row.packageCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-10 grid grid-cols-2 gap-12 text-sm">
          <p className="border-t border-black pt-2">Pripremio</p>
          <p className="border-t border-black pt-2">Kontrolisao</p>
        </div>
      </section>
    </main>
  );
}

function providerLabel(provider: string | null) {
  return provider === "MYGLS" ? "MyGLS" : provider === "X_EXPRESS" ? "X Express" : provider ?? "Kurir";
}
