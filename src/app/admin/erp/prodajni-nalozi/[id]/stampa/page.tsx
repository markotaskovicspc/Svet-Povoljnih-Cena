import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintPageButton } from "@/components/admin/print-page-button";
import { requireAdminAction } from "@/lib/admin";
import { calculateSalesLineTotals } from "@/lib/admin/sales-order";
import { getSalesOrderDetail } from "@/lib/admin/sales-order.server";
import { MERCHANT_LEGAL_INFO } from "@/lib/merchant";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Štampa predračuna · ERP",
  robots: { index: false, follow: false },
};

export default async function SalesOrderPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminAction(["OPS"]);
  const { id } = await params;
  const detail = await getSalesOrderDetail(id);
  if (!detail || detail.channel === "WEB" || detail.channel === "ANANAS") {
    notFound();
  }

  const totals = detail.lines.reduce(
    (sum, line) => {
      const calculated = calculateSalesLineTotals(
        line.qty,
        Number(line.unitPrice) || 0,
      );
      return {
        net: sum.net + calculated.totalNet,
        vat: sum.vat + calculated.totalVat,
        gross: sum.gross + calculated.totalGross,
      };
    },
    { net: 0, vat: 0, gross: 0 },
  );

  return (
    <main className="mx-auto min-h-screen max-w-[1100px] bg-white p-8 text-black print:max-w-none print:p-0">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href={`/admin/erp/prodajni-nalozi/${detail.id}`}
          className="text-sm underline"
        >
          ← Nazad na porudžbinu
        </Link>
        <PrintPageButton label="Štampaj predračun" />
      </div>

      <header className="flex items-start justify-between gap-8 border-b-4 border-[#28579c] pb-5">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.15em] text-[#28579c]">
            Svet Povoljnih Cena
          </p>
          <p className="mt-2 max-w-xl text-sm font-semibold">
            {MERCHANT_LEGAL_INFO.name}
          </p>
          <p className="mt-1 text-xs leading-5">
            {MERCHANT_LEGAL_INFO.shortAddress}
            <br />
            PIB {MERCHANT_LEGAL_INFO.pib} · MB {MERCHANT_LEGAL_INFO.registrationNumber}
            <br />
            Račun {MERCHANT_LEGAL_INFO.bankAccount} ({MERCHANT_LEGAL_INFO.bankName})
          </p>
        </div>
        <div className="text-right">
          <h1 className="text-4xl font-black text-[#28579c]">PREDRAČUN</h1>
          <p className="mt-2 font-mono text-lg font-bold">PR-{detail.number}</p>
          <p className="mt-1 text-sm">
            Datum: {formatDate(detail.createdAt)}
          </p>
          <p className="text-sm">Kanal: {detail.channel}</p>
        </div>
      </header>

      <section className="mt-6 grid grid-cols-2 gap-5">
        <Party title="Prodavac">
          <p className="font-bold">{MERCHANT_LEGAL_INFO.name}</p>
          <p>{MERCHANT_LEGAL_INFO.shortAddress}</p>
          <p>PIB {MERCHANT_LEGAL_INFO.pib}</p>
        </Party>
        <Party title="Kupac">
          <p className="font-bold">
            {detail.customerSnapshot.companyName || detail.customerSnapshot.label}
          </p>
          {detail.customerSnapshot.pib ? (
            <p>PIB {detail.customerSnapshot.pib}</p>
          ) : null}
          <p>{detail.customerSnapshot.address}</p>
          <p>
            {detail.customerSnapshot.postalCode} {detail.customerSnapshot.city}
          </p>
          <p>{detail.customerSnapshot.email}</p>
        </Party>
      </section>

      <table className="mt-7 w-full border-collapse text-sm">
        <thead>
          <tr className="bg-[#28579c] text-left text-white">
            <th className="px-3 py-2">R.br.</th>
            <th className="px-3 py-2">Šifra</th>
            <th className="px-3 py-2">Pun naziv artikla</th>
            <th className="px-3 py-2 text-right">Kol.</th>
            <th className="px-3 py-2 text-right">MP cena</th>
            <th className="px-3 py-2 text-right">Ukupno</th>
          </tr>
        </thead>
        <tbody>
          {detail.lines.map((line, index) => {
            const total = calculateSalesLineTotals(
              line.qty,
              Number(line.unitPrice) || 0,
            ).totalGross;
            return (
              <tr key={line.id ?? `${line.sku}-${index}`} className="border-b border-black/20">
                <td className="px-3 py-3">{index + 1}</td>
                <td className="px-3 py-3 font-mono">{line.sku}</td>
                <td className="px-3 py-3">
                  <span className="font-semibold">{line.name}</span>
                  {line.shortName && line.shortName !== line.name ? (
                    <span className="block text-xs text-black/60">
                      Kratki naziv: {line.shortName}
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-3 text-right">{line.qty}</td>
                <td className="px-3 py-3 text-right">
                  {money(Number(line.unitPrice) || 0, detail.currency)}
                </td>
                <td className="px-3 py-3 text-right font-semibold">
                  {money(total, detail.currency)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <section className="ml-auto mt-8 w-full max-w-md space-y-2 text-sm">
        <TotalRow label="Osnovica bez PDV-a" value={money(totals.net, detail.currency)} />
        <TotalRow label="PDV 20%" value={money(totals.vat, detail.currency)} />
        <div className="flex items-center justify-between bg-[#eaf1fa] px-4 py-4 text-xl font-black text-[#28579c]">
          <span>UKUPNO ZA UPLATU</span>
          <span>{money(totals.gross, detail.currency)}</span>
        </div>
      </section>

      <footer className="mt-16 grid grid-cols-2 gap-16 text-sm">
        <p className="border-t border-black pt-2">Izdao</p>
        <p className="border-t border-black pt-2">Kupac</p>
      </footer>
    </main>
  );
}

function Party({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-36 border border-black/20 p-4 text-sm leading-6">
      <h2 className="mb-2 text-xs font-black uppercase tracking-[0.12em] text-[#28579c]">
        {title}
      </h2>
      {children}
    </div>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-black/20 px-4 py-2">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function money(value: number, currency: string) {
  return `${new Intl.NumberFormat("sr-Latn-RS", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)} ${currency}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("sr-Latn-RS", {
    timeZone: "Europe/Belgrade",
    dateStyle: "long",
  }).format(new Date(value));
}
